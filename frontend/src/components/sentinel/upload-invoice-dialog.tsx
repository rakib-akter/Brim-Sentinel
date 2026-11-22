import { useRef, useState, type DragEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Check, FileUp, Loader2, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { errorMessage } from "./workflow-form";
import { api } from "@/lib/api/client";
import type { InvoiceSummary } from "@/lib/api/schema";
import { formatMoney } from "@/lib/format";
import { useSession } from "@/lib/session";

const ACCEPT = [".pdf", ".png", ".jpg", ".jpeg"];
const MAX_BYTES = 10 * 1024 * 1024;

function validate(file: File): string | null {
  const ext = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
  if (!ACCEPT.includes(ext)) return `${file.name}: only PDF, PNG or JPG files can be uploaded.`;
  if (!file.size) return `${file.name}: the file is empty.`;
  if (file.size > MAX_BYTES) return `${file.name}: files must be 10 MB or smaller.`;
  return null;
}

/** What Sentinel does to every upload, shown one by one so the work is visible. */
const STAGES = [
  "Uploading the file",
  "Reading the document",
  "Pulling out supplier, amounts and line items",
  "Checking supplier records, purchase orders and duplicates",
  "Applying the approval rules",
] as const;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const reducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function UploadInvoiceDialog({ trigger }: { trigger?: React.ReactNode }) {
  const { user } = useSession();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [phase, setPhase] = useState(-1);
  const [fileIndex, setFileIndex] = useState(0);
  const [summary, setSummary] = useState<InvoiceSummary | null>(null);
  const phaseRef = useRef(-1);
  const advance = (to: number) => {
    phaseRef.current = to;
    setPhase(to);
  };

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    if (upload.isPending) return;
    const incoming = Array.from(list);
    const problem = incoming.map(validate).find(Boolean) ?? null;
    setError(problem);
    setFiles((prev) => [...prev, ...incoming.filter((f) => !validate(f))]);
  };

  const upload = useMutation({
    mutationFn: async () => {
      let completed = 0;
      let created = 0;
      const invoiceIds: string[] = [];
      const step = reducedMotion() ? 0 : 650;
      setSummary(null);
      advance(0);
      // Walk the stages at a readable pace while the server works; hold on the last one
      // until the real result is back, so the list never claims more than has happened.
      const ticker = setInterval(
        () => advance(Math.min(phaseRef.current + 1, STAGES.length - 1)),
        Math.max(step, 1),
      );
      let last: InvoiceSummary | null = null;
      try {
        for (const [index, file] of files.entries()) {
          setFileIndex(index);
          try {
            const result = await api.upload(user.id, file);
            if (result.created) created++;
            invoiceIds.push(result.invoice.id);
            last = result.invoice;
            completed++;
          } catch (error) {
            setFiles(files.slice(completed));
            throw new Error(
              `${file.name}: ${error instanceof Error ? errorMessage(error) : "Upload failed."}`,
            );
          }
        }
      } finally {
        clearInterval(ticker);
      }
      while (phaseRef.current < STAGES.length) {
        advance(phaseRef.current + 1);
        await sleep(step / 2);
      }
      setSummary(last);
      await sleep(step ? 1600 : 0);
      return { completed, created, invoiceIds };
    },
    onSettled: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["invoices"] }),
        qc.invalidateQueries({ queryKey: ["home"] }),
      ]);
    },
    onSuccess: ({ completed, created, invoiceIds }) => {
      const reused = completed - created;
      const single = invoiceIds.length === 1 ? invoiceIds[0] : undefined;
      toast.success(
        created
          ? `${created} ${created === 1 ? "draft" : "drafts"} created`
          : "Invoices already in the inbox",
        {
          description: reused
            ? `${reused} ${reused === 1 ? "file was" : "files were"} already received.`
            : single
              ? "Opening it so you can review what Sentinel found."
              : "Review the invoices and their checks in the inbox.",
          ...(single
            ? {}
            : {
                action: {
                  label: "Open first",
                  onClick: () =>
                    void navigate({
                      to: "/invoices/$invoiceId",
                      params: { invoiceId: invoiceIds[0] ?? "" },
                    }),
                },
              }),
        },
      );
      setFiles([]);
      setOpen(false);
      setTimeout(() => {
        advance(-1);
        setSummary(null);
      }, 300);
      // One file: go straight to its review so the result of processing is visible immediately.
      if (single) void navigate({ to: "/invoices/$invoiceId", params: { invoiceId: single } });
    },
    onError: (error) => {
      advance(-1);
      setError(error.message);
    },
  });

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    addFiles(e.dataTransfer.files);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (upload.isPending) return;
        setOpen(o);
        if (!o) {
          setFiles([]);
          setError(null);
          advance(-1);
          setSummary(null);
        }
      }}
    >
      <DialogTrigger asChild>
        {trigger ?? (
          <Button>
            <Upload aria-hidden /> Upload invoice
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Upload invoices</DialogTitle>
          <DialogDescription>
            English or French PDFs and scanned images. Each file becomes its own draft for review —
            nothing is paid automatically.
          </DialogDescription>
        </DialogHeader>
        {phase >= 0 ? (
          <Processing phase={phase} fileIndex={fileIndex} total={files.length} summary={summary} />
        ) : (
          <>
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              className={`dot-grid flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors ${
                dragging ? "border-primary bg-primary-soft" : "border-border-strong"
              }`}
            >
              <div className="mb-3 grid size-11 place-items-center rounded-xl bg-card text-primary shadow-card">
                <FileUp className="size-5" aria-hidden />
              </div>
              <p className="text-sm font-medium">Drag files here</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                PDF, PNG or JPG · up to 10 MB each
              </p>
              <Button
                variant="outline"
                disabled={upload.isPending}
                size="sm"
                className="mt-4"
                onClick={() => inputRef.current?.click()}
              >
                Choose files
              </Button>
              <input
                ref={inputRef}
                type="file"
                multiple
                accept={ACCEPT.join(",")}
                className="sr-only"
                aria-label="Choose invoice files"
                onChange={(e) => {
                  addFiles(e.target.files);
                  e.target.value = "";
                }}
              />
            </div>
            {error ? (
              <p
                role="alert"
                className="rounded-lg bg-critical-soft px-3 py-2 text-xs text-critical-foreground"
              >
                {error}
              </p>
            ) : null}
            {files.length ? (
              <ul className="divide-y rounded-lg border">
                {files.map((f, i) => (
                  <li key={`${f.name}-${i}`} className="flex items-center gap-3 px-3 py-2 text-sm">
                    <FileUp className="size-4 text-muted-foreground" aria-hidden />
                    <span className="min-w-0 flex-1 truncate">{f.name}</span>
                    <span className="figure text-xs text-muted-foreground">
                      {(f.size / 1024).toFixed(0)} KB
                    </span>
                    <button
                      type="button"
                      disabled={upload.isPending}
                      aria-label={`Remove ${f.name}`}
                      onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                      className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
                    >
                      <X className="size-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        )}
        {phase >= 0 ? null : (
          <DialogFooter>
            <Button variant="ghost" disabled={upload.isPending} onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button disabled={!files.length || upload.isPending} onClick={() => upload.mutate()}>
              {upload.isPending ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : (
                <Upload aria-hidden />
              )}
              Upload {files.length ? files.length : ""}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Processing({
  phase,
  fileIndex,
  total,
  summary,
}: {
  phase: number;
  fileIndex: number;
  total: number;
  summary: InvoiceSummary | null;
}) {
  const done = phase >= STAGES.length;
  return (
    <div className="rise-in space-y-4" role="status" aria-live="polite">
      {total > 1 && !done ? (
        <p className="text-xs text-muted-foreground">
          File {fileIndex + 1} of {total}
        </p>
      ) : null}
      <ol className="space-y-2.5">
        {STAGES.map((label, i) => {
          const state = i < phase ? "done" : i === phase ? "active" : "waiting";
          return (
            <li
              key={label}
              className={`flex items-center gap-3 text-sm transition-opacity duration-300 ${
                state === "waiting" ? "opacity-40" : "opacity-100"
              }`}
            >
              <span
                className={`grid size-6 shrink-0 place-items-center rounded-full border transition-colors duration-300 ${
                  state === "done"
                    ? "border-primary bg-primary text-primary-foreground"
                    : state === "active"
                      ? "border-primary text-primary"
                      : "border-border-strong"
                }`}
              >
                {state === "done" ? (
                  <Check className="size-3.5 animate-in zoom-in-50 duration-200" aria-hidden />
                ) : state === "active" ? (
                  <Loader2 className="size-3.5 animate-spin" aria-hidden />
                ) : null}
              </span>
              <span className={state === "active" ? "font-medium" : ""}>{label}</span>
            </li>
          );
        })}
      </ol>
      {done && summary ? (
        <div className="rounded-lg border bg-primary-soft/40 px-4 py-3 animate-in fade-in slide-in-from-bottom-2 duration-300">
          <p className="text-sm font-medium">
            {summary.vendor_name ?? "Unknown supplier"}
            {summary.amount_minor != null && summary.currency
              ? ` · ${formatMoney(summary.amount_minor, summary.currency)}`
              : ""}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {summary.blocking_findings_count
              ? `${summary.blocking_findings_count} ${summary.blocking_findings_count === 1 ? "thing needs" : "things need"} a look before it can be paid. Opening the invoice…`
              : `${summary.plain_status}. Opening the invoice…`}
          </p>
        </div>
      ) : null}
    </div>
  );
}
