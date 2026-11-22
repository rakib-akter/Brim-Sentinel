import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useId, useRef, useSyncExternalStore, type ComponentProps, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiError } from "@/lib/api/http-api";
import { plain } from "@/lib/plain-language";
import { useSession } from "@/lib/session";

export function errorMessage(error: Error) {
  const reasons = error instanceof ApiError ? error.details["blocked_reasons"] : undefined;
  const prefix = error instanceof ApiError && error.status === 403 ? "Permission denied. " : "";
  return prefix + [error.message, ...(Array.isArray(reasons) ? reasons : [])].join(" ");
}

export function downloadFile(data: Blob, name: string) {
  const url = URL.createObjectURL(data);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const subscribeToHydration = () => () => {};
const isClientReady = () => true;
const isServerReady = () => false;

export function WorkflowForm({
  label,
  run,
  children,
  refresh = true,
  success = "Saved.",
  clearOnSuccess = false,
}: {
  label: string;
  run: (fields: FormData) => Promise<unknown>;
  children?: ReactNode;
  refresh?: boolean;
  success?: string;
  clearOnSuccess?: boolean;
}) {
  const ready = useSyncExternalStore(subscribeToHydration, isClientReady, isServerReady);
  const cache = useQueryClient();
  const { user } = useSession();
  const refreshRecords = () =>
    cache.invalidateQueries({
      predicate: ({ queryKey }) =>
        queryKey[1] === user.id && queryKey[0] !== "me" && queryKey[0] !== "invoice-document",
    });
  const submitting = useRef(false);
  const form = useRef<HTMLFormElement>(null);
  const payload = useRef<FormData | null>(null);
  const mutation = useMutation({
    mutationFn: async () => {
      const fields = payload.current;
      payload.current = null;
      if (!fields) throw new Error("Submit the form again.");
      return run(fields);
    },
    retry: false,
    onSuccess: async () => {
      if (clearOnSuccess) form.current?.reset();
      if (refresh) await refreshRecords();
    },
    onError: async (error) => {
      if (refresh && error instanceof ApiError && error.status === 409) await refreshRecords();
    },
    onSettled: () => {
      submitting.current = false;
    },
  });
  return (
    <form
      ref={form}
      method="post"
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (!ready || submitting.current) return;
        submitting.current = true;
        payload.current = new FormData(event.currentTarget);
        mutation.mutate();
      }}
    >
      <fieldset disabled={!ready || mutation.isPending} className="space-y-3">
        {children}
        <Button size="sm" type="submit">
          {mutation.isPending ? "Working…" : label}
        </Button>
      </fieldset>
      {mutation.isError && (
        <p role="alert" className="text-sm text-critical-foreground">
          {errorMessage(mutation.error)}
        </p>
      )}
      {mutation.isSuccess && success && (
        <p role="status" className="text-sm text-success-foreground">
          {success}
        </p>
      )}
    </form>
  );
}

export function Field({
  label,
  name,
  type = "text",
  required = true,
  defaultValue,
  ...inputProps
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  defaultValue?: string;
} & Pick<ComponentProps<typeof Input>, "inputMode" | "autoComplete">) {
  return (
    <label className="block text-sm">
      {label}
      <Input className="mt-1" {...{ name, type, required, defaultValue }} {...inputProps} />
    </label>
  );
}

export function Choice({
  label,
  name,
  options,
  required = true,
}: {
  label: string;
  name: string;
  options: { value: string; label: string }[];
  required?: boolean;
}) {
  const id = useId();
  return (
    <div className="text-sm">
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        className="mt-1 block w-full rounded-md border bg-background px-3 py-2"
        name={name}
        required={required}
      >
        <option value="">Choose an option</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export const value = (fields: FormData, name: string) => String(fields.get(name) ?? "").trim();
/** Plain-language label for a backend code (see lib/plain-language). */
export const humanize = (key: string) => plain(key);
