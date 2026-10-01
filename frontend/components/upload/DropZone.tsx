"use client";

import { UploadCloud } from "lucide-react";
import { useCallback } from "react";
import { useDropzone } from "react-dropzone";
import { Button, ProgressBar } from "@/components/ui";
import { mb } from "@/lib/format";
import { PLAN_LIMITS } from "@/lib/flags";
import type { UploadState } from "@/lib/upload/useDemoUpload";
import { cn } from "@/lib/utils";

const phaseLabel: Record<UploadState["phase"], string> = {
  idle: "",
  preparing: "Preparing…",
  compressing: "Compressing…",
  uploading: "Uploading",
  finalizing: "Finishing up…",
  done: "Done",
  error: "",
};

export function DropZone({
  state,
  onFile,
  onCancel,
  disabled,
  compact,
}: {
  state: UploadState;
  onFile: (file: File) => void;
  onCancel: () => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  const onDrop = useCallback((files: File[]) => files[0] && onFile(files[0]), [onFile]);
  const busy = state.phase !== "idle" && state.phase !== "error" && state.phase !== "done";
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { "application/octet-stream": [".dem"] },
    maxFiles: 1,
    disabled: disabled || busy,
  });

  if (busy) {
    return (
      <div className="surface-2 p-5" aria-live="polite">
        <div className="mb-2 flex items-center justify-between text-sm">
          <span className="font-semibold">{phaseLabel[state.phase]}</span>
          <span className="num" style={{ color: "var(--color-text-2)" }}>
            {state.phase === "uploading" ? `${state.progress}% · ${mb(state.bytesUploaded)} / ${mb(state.totalBytes)}${state.speed ? ` · ${state.speed}` : ""}` : ""}
          </span>
        </div>
        <ProgressBar value={state.phase === "uploading" ? state.progress : state.phase === "finalizing" ? 99 : 5} label="Upload progress" />
        <div className="mt-3 flex justify-end">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div
        {...getRootProps()}
        className={cn(
          "surface-2 flex cursor-pointer flex-col items-center justify-center text-center transition-[border-color,background-color] duration-[var(--dur-fast)]",
          compact ? "px-4 py-6" : "px-6 py-10",
          disabled && "cursor-not-allowed opacity-60",
        )}
        style={{
          borderStyle: "dashed",
          borderColor: isDragActive ? "var(--color-accent)" : undefined,
          background: isDragActive ? "var(--color-accent-soft)" : undefined,
        }}
      >
        <input {...getInputProps()} aria-label="Upload a CS2 demo file" />
        <UploadCloud size={compact ? 22 : 28} style={{ color: isDragActive ? "var(--color-accent)" : "var(--color-text-2)" }} aria-hidden="true" />
        <p className="mt-3 text-sm font-semibold">Drop a CS2 demo here</p>
        <p className="num mt-1 text-[12px]" style={{ color: "var(--color-text-3)" }}>
          or click to browse · .dem · up to {PLAN_LIMITS.free.maxFileSizeMB} MB
        </p>
      </div>
      {state.phase === "error" && state.error ? (
        <p className="mt-2 text-[13px]" style={{ color: "var(--color-danger)" }} role="alert">
          {state.error}
        </p>
      ) : null}
    </div>
  );
}
