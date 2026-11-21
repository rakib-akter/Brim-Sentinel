import { useRef, useState, type DragEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FileUp, Loader2, Upload, X } from "lucide-react";
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
import { api } from "@/lib/api/client";
import { useSession } from "@/lib/session";

const ACCEPT = [".pdf", ".png", ".jpg", ".jpeg"];
const MAX_BYTES = 20 * 1024 * 1024;

function validate(file: File): string | null {
  const ext = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
  if (!ACCEPT.includes(ext)) return `${file.name}: only PDF, PNG or JPG files can be uploaded.`;
  if (file.size > MAX_BYTES) return `${file.name}: files must be 20 MB or smaller.`;
  return null;
}

export function UploadInvoiceDialog({ trigger }: { trigger?: React.ReactNode }) {
  const { user } = useSession();
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    const incoming = Array.from(list);
    const problem = incoming.map(validate).find(Boolean) ?? null;
    setError(problem);
    setFiles((prev) => [...prev, ...incoming.filter((f) => !validate(f))]);
  };

  const upload = useMutation({
    mutationFn: async () => {
      for (const f of files) await api.uploadInvoice(user.id, { fileName: f.name, sizeBytes: f.size });
    },
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["invoices"] }),
        qc.invalidateQueries({ queryKey: ["home"] }),
      ]);
      toast.success(`${files.length} ${files.length === 1 ? "document" : "documents"} uploaded`, {
        description: "Sentinel is reading them now. They'll appear as Processing in the inbox.",
      });
      setFiles([]);
      setOpen(false);
    },
    onError: () => setError("Upload failed. Your files were not added — please try again."),
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
        setOpen(o);
        if (!o) {
          setFiles([]);
          setError(null);
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
            English or French PDFs and scanned images. Each file becomes its own draft for review — nothing is paid
            automatically.
          </DialogDescription>
        </DialogHeader>
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
          <p className="mt-0.5 text-xs text-muted-foreground">PDF, PNG or JPG · up to 20 MB each</p>
          <Button variant="outline" size="sm" className="mt-4" onClick={() => inputRef.current?.click()}>
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
          <p role="alert" className="rounded-lg bg-critical-soft px-3 py-2 text-xs text-critical-foreground">
            {error}
          </p>
        ) : null}
        {files.length ? (
          <ul className="divide-y rounded-lg border">
            {files.map((f, i) => (
              <li key={`${f.name}-${i}`} className="flex items-center gap-3 px-3 py-2 text-sm">
                <FileUp className="size-4 text-muted-foreground" aria-hidden />
                <span className="min-w-0 flex-1 truncate">{f.name}</span>
                <span className="figure text-xs text-muted-foreground">{(f.size / 1024).toFixed(0)} KB</span>
                <button
                  type="button"
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
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button disabled={!files.length || upload.isPending} onClick={() => upload.mutate()}>
            {upload.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <Upload aria-hidden />}
            Upload {files.length ? files.length : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
