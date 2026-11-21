import { ApiError } from "@/lib/api/http-api";
import { Button } from "@/components/ui/button";
import { errorMessage } from "./workflow-form";

export function QueryState({
  error,
  loading,
  retry,
}: {
  error: Error | null;
  loading: string;
  retry: () => unknown;
}) {
  if (!error)
    return (
      <p className="p-5 text-sm" role="status">
        {loading}
      </p>
    );
  const forbidden = error instanceof ApiError && [401, 403].includes(error.status);
  const missing = error instanceof ApiError && error.status === 404;
  return (
    <div className="space-y-3 p-5 text-sm">
      <p role="alert">
        {forbidden
          ? "Your demo role does not have access to this view."
          : missing
            ? "This record could not be found."
            : errorMessage(error)}
      </p>
      {!forbidden && !missing && (
        <Button variant="outline" size="sm" onClick={() => void retry()}>
          Try again
        </Button>
      )}
    </div>
  );
}
