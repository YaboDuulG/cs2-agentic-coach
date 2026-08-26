"use client";

import { useCallback, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { useDropzone } from "react-dropzone";
import { Upload, X, Clock } from "lucide-react";
import { PLAN_LIMITS } from "@/lib/flags";
import { Button, Progress, Spinner } from "@/components/ui";

const MAX_MB = PLAN_LIMITS.free.maxFileSizeMB;
const MAX_BYTES = MAX_MB * 1024 * 1024;

interface UploadZoneProps {
  onSuccess?: () => void;
  teamId?: string;
  defaultMode?: "individual" | "team";
}

export function UploadZone({ onSuccess, teamId, defaultMode }: UploadZoneProps) {
  const router = useRouter();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [bytesUploaded, setBytesUploaded] = useState(0);
  const [totalBytes, setTotalBytes] = useState(0);
  const [uploadSpeed, setUploadSpeed] = useState<string | null>(null);
  const [isRecon, setIsRecon] = useState(false);

  const xhrListRef = useRef<XMLHttpRequest[]>([]);
  const startTimeRef = useRef<number>(0);

  const cancelUpload = () => {
    xhrListRef.current.forEach((xhr) => xhr.abort());
    xhrListRef.current = [];
    setUploading(false);
    setProgress(0);
    setBytesUploaded(0);
    setUploadSpeed(null);
    setError("Upload cancelled.");
  };

  const onDrop = useCallback(async (accepted: File[]) => {
    const file = accepted[0];
    if (!file) return;
    if (!file.name.endsWith(".dem")) {
      setError("This isn't a CS2 demo (.dem). Export the demo from your match history and try again.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError(`File is over the ${MAX_MB}MB limit for your plan.`);
      return;
    }

    setError(null);
    setUploading(true);
    setProgress(0);
    setBytesUploaded(0);
    setUploadSpeed("Preparing...");

    try {
      let uploadFile: File | Blob = file;
      let uploadName = file.name;

      if (typeof CompressionStream !== "undefined") {
        try {
          setUploadSpeed("Compressing...");
          const compressedStream = file.stream().pipeThrough(new CompressionStream("gzip"));
          const compressedBlob = await new Response(compressedStream).blob();
          uploadFile = compressedBlob;
          uploadName = file.name + ".gz";
        } catch (err) {
          console.error("Compression failed, using raw file:", err);
        }
      }

      setTotalBytes(uploadFile.size);
      setUploadSpeed("Calculating...");
      startTimeRef.current = Date.now();

      // Ensure the number of chunks does not exceed 32 (GCS limit for compose)
      let chunkSize = 5 * 1024 * 1024; // 5 MB default
      let chunkCount = Math.ceil(uploadFile.size / chunkSize);
      if (chunkCount > 32) {
        chunkSize = Math.ceil(uploadFile.size / 32);
        chunkCount = 32;
      }

      if (chunkCount > 1) {
        // --- 1. Get presigned URLs for chunks ---
        const presignRes = await fetch("/api/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            filename: uploadName,
            size_bytes: uploadFile.size,
            team_id: teamId,
            chunk_count: chunkCount,
            is_recon: isRecon,
          }),
        });

        if (!presignRes.ok) {
          const err = await presignRes.json();
          if (presignRes.status === 429) {
            throw new Error(`Quota exceeded — ${err.detail ?? "upgrade to continue"}`);
          }
          throw new Error(err.detail ?? "Failed to start upload");
        }

        const { job_id, upload_urls } = await presignRes.json();

        // --- 2. Upload chunks in parallel using XMLHttpRequest ---
        const chunkProgress = new Array(chunkCount).fill(0);
        xhrListRef.current = [];

        const uploadPromises = upload_urls.map((url: string, index: number) => {
          return new Promise<void>((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhrListRef.current.push(xhr);

            const start = index * chunkSize;
            const end = Math.min((index + 1) * chunkSize, uploadFile.size);
            const chunkBlob = uploadFile.slice(start, end);

            xhr.upload.addEventListener("progress", (event) => {
              if (event.lengthComputable) {
                chunkProgress[index] = event.loaded;
                const totalLoaded = chunkProgress.reduce((sum, val) => sum + val, 0);
                // Cap at 99% until backend composition completes successfully
                const pct = Math.min(99, Math.round((totalLoaded / uploadFile.size) * 100));
                setProgress(pct);
                setBytesUploaded(totalLoaded);

                const elapsedMs = Date.now() - startTimeRef.current;
                if (elapsedMs > 500) {
                  const speedBytesPerSec = (totalLoaded / elapsedMs) * 1000;
                  const speedMbPerSec = speedBytesPerSec / (1024 * 1024);
                  setUploadSpeed(`${speedMbPerSec.toFixed(1)} MB/s`);
                }
              }
            });

            xhr.addEventListener("load", () => {
              if (xhr.status >= 200 && xhr.status < 300) {
                resolve();
              } else {
                reject(new Error(`Chunk ${index} failed with status ${xhr.status}`));
              }
            });

            xhr.addEventListener("error", () => {
              reject(new Error(`Network error on chunk ${index}`));
            });

            xhr.open("PUT", url);
            xhr.setRequestHeader("Content-Type", "application/octet-stream");
            xhr.send(chunkBlob);
          });
        });

        await Promise.all(uploadPromises);

        // --- 3. Trigger composition ---
        setUploadSpeed("Processing...");
        const composeRes = await fetch("/api/upload/compose", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            match_id: job_id,
            filename: uploadName,
            chunk_count: chunkCount,
            team_id: teamId,
          }),
        });

        if (!composeRes.ok) {
          const err = await composeRes.json();
          throw new Error(err.detail ?? "Failed to finalize chunk composition");
        }

        setProgress(100);
        if (onSuccess) onSuccess();
        router.push(`/analysis/${job_id}`);

      } else {
        // --- Single chunk upload ---
        const presignRes = await fetch("/api/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            filename: uploadName,
            size_bytes: uploadFile.size,
            team_id: teamId,
            chunk_count: 1,
            is_recon: isRecon,
          }),
        });

        if (!presignRes.ok) {
          const err = await presignRes.json();
          if (presignRes.status === 429) {
            throw new Error(`Quota exceeded — ${err.detail ?? "upgrade to continue"}`);
          }
          throw new Error(err.detail ?? "Failed to start upload");
        }

        const { job_id, upload_url } = await presignRes.json();

        const xhr = new XMLHttpRequest();
        xhrListRef.current = [xhr];

        xhr.upload.addEventListener("progress", (event) => {
          if (event.lengthComputable) {
            const pct = Math.round((event.loaded / event.total) * 100);
            setProgress(pct);
            setBytesUploaded(event.loaded);

            const elapsedMs = Date.now() - startTimeRef.current;
            if (elapsedMs > 500) {
              const speedBytesPerSec = (event.loaded / elapsedMs) * 1000;
              const speedMbPerSec = speedBytesPerSec / (1024 * 1024);
              setUploadSpeed(`${speedMbPerSec.toFixed(1)} MB/s`);
            }
          }
        });

        xhr.addEventListener("load", () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            if (onSuccess) onSuccess();
            router.push(`/analysis/${job_id}`);
          } else {
            setError(`Upload failed. Server responded with status ${xhr.status}.`);
            setUploading(false);
          }
        });

        xhr.addEventListener("error", () => {
          setError("Network error occurred during upload.");
          setUploading(false);
        });

        xhr.open("PUT", upload_url);
        xhr.setRequestHeader("Content-Type", "application/octet-stream");
        xhr.send(uploadFile);
      }

    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed.");
      setUploading(false);
    }
  }, [router, onSuccess, teamId, isRecon]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { "application/octet-stream": [".dem"] },
    maxFiles: 1,
    disabled: uploading,
  });

  const formatMB = (bytes: number) => {
    return (bytes / (1024 * 1024)).toFixed(1);
  };

  return (
    <div className="w-full">
      {uploading ? (
        <div className="card relative mx-auto p-8 max-w-[540px] text-center">
          <Button
            variant="ghost"
            size="icon"
            onClick={cancelUpload}
            aria-label="Cancel upload"
            className="absolute top-4 right-4 rounded-full"
          >
            <X size={14} />
          </Button>

          <div className="flex flex-col items-center gap-6">
            <div className="relative flex items-center justify-center">
              <Spinner size={64} />
              <span className="absolute text-xs font-mono font-bold" style={{ color: "var(--color-text-primary)" }}>
                {progress}%
              </span>
            </div>

            <div className="space-y-1.5">
              <h3 className="font-bold text-sm tracking-wider" style={{ color: "var(--color-text-primary)" }}>
                Uploading your demo…
              </h3>
              <p className="text-xs font-mono" style={{ color: "var(--color-text-secondary)" }}>
                {formatMB(bytesUploaded)} MB / {formatMB(totalBytes)} MB
              </p>
            </div>

            <div className="w-full space-y-1">
              <Progress value={progress} label="Upload progress" />
              <div className="flex justify-between text-[9px] font-mono" style={{ color: "var(--color-text-muted)" }}>
                <span className="flex items-center gap-1">
                  <Clock size={10} />
                  {uploadSpeed || "Calculating..."}
                </span>
                <span>Keep this window open</span>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center">
          {/* Circular compass dropzone — the khan's war-council table */}
          <div
            {...getRootProps()}
            className="relative cursor-pointer mx-auto rounded-full w-72 h-72 flex items-center justify-center overflow-hidden group select-none"
            style={{
              background: isDragActive ? "var(--color-accent-soft)" : "var(--color-bg-card)",
              border: `2px solid ${isDragActive ? "var(--color-accent-secondary)" : "var(--color-border-strong)"}`,
              backdropFilter: "blur(12px)",
              boxShadow: isDragActive ? "var(--shadow-gold)" : "var(--shadow-card)",
              transition: "background-color var(--dur-fast) ease, border-color var(--dur-fast) ease, box-shadow var(--dur-fast) ease",
            }}
          >
            {/* Blueprint grid backdrop */}
            <div className="absolute inset-0 pointer-events-none opacity-20 bg-[radial-gradient(circle_at_center,var(--color-accent-glow)_0%,transparent_75%)] bg-[linear-gradient(rgba(255,255,255,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.05)_1px,transparent_1px)] bg-[size:16px_16px]" />

            {/* Slow decorative rings — stilled under prefers-reduced-motion */}
            <div
              className="ds-decorative-motion absolute inset-2 border-2 border-dashed rounded-full animate-spin pointer-events-none"
              style={{ animationDuration: "25s", borderColor: "var(--color-border-primary)" }}
            />
            <div
              className="ds-decorative-motion absolute inset-6 border border-dotted rounded-full animate-spin pointer-events-none"
              style={{ animationDuration: "40s", animationDirection: "reverse", borderColor: "var(--color-border-secondary)" }}
            />
            <div className="absolute inset-10 border rounded-full pointer-events-none" style={{ borderColor: "var(--color-border-primary)" }} />

            <input {...getInputProps()} aria-label="Upload a CS2 demo file" />

            <div className="relative z-10 flex flex-col items-center gap-3 text-center px-6">
              <div
                className="w-14 h-14 rounded-full flex items-center justify-center"
                style={{
                  background: isDragActive ? "var(--color-secondary-soft)" : "var(--color-accent-soft)",
                  border: `1px solid ${isDragActive ? "var(--color-accent-secondary)" : "var(--color-border-strong)"}`,
                  transform: isDragActive ? "scale(1.05)" : "scale(1)",
                  transition: "transform var(--dur-fast) var(--ease-out), background-color var(--dur-fast) ease, border-color var(--dur-fast) ease",
                }}
              >
                <Upload
                  size={22}
                  style={{ color: isDragActive ? "var(--color-accent-secondary)" : "var(--color-accent-primary)" }}
                />
              </div>
              <div className="space-y-1">
                <p className="font-bold text-sm tracking-wide" style={{ color: "var(--color-text-primary)" }}>
                  {isDragActive ? "Release to upload" : "Drop a CS2 demo here"}
                </p>
                <p className="text-[11px] leading-tight" style={{ color: "var(--color-text-secondary)" }}>
                  or click to browse<br />
                  <span className="font-mono" style={{ color: "var(--color-text-muted)" }}>.dem (max {MAX_MB}MB)</span>
                </p>
              </div>
            </div>
          </div>

          {/* Opposition-recon toggle — team mode only */}
          {defaultMode !== "individual" && (
            <div
              className="mt-6 p-4 rounded-xl border flex items-start gap-3 select-none w-full max-w-[480px]"
              style={{
                background: isRecon ? "var(--color-secondary-soft)" : "var(--color-bg-card)",
                borderColor: isRecon ? "var(--color-accent-secondary)" : "var(--color-border-primary)",
                transition: "background-color var(--dur-fast) ease, border-color var(--dur-fast) ease",
              }}
            >
              <input
                type="checkbox"
                id="is-recon-checkbox"
                checked={isRecon}
                onChange={(e) => setIsRecon(e.target.checked)}
                className="mt-1 w-4 h-4 rounded cursor-pointer"
                style={{ accentColor: "var(--color-accent-secondary)" }}
              />
              <label htmlFor="is-recon-checkbox" className="flex-1 text-left cursor-pointer select-none">
                <span className="text-xs font-bold flex items-center gap-1.5" style={{ color: isRecon ? "var(--color-accent-secondary)" : "var(--color-text-primary)" }}>
                  Scout the opposition
                  {isRecon && (
                    <span
                      className="text-[9px] px-1.5 py-0.5 rounded font-mono font-bold uppercase tracking-wider"
                      style={{ background: "var(--color-secondary-soft)", color: "var(--color-accent-secondary)" }}
                    >
                      On
                    </span>
                  )}
                </span>
                <p className="text-[11px] mt-1 leading-normal" style={{ color: "var(--color-text-muted)" }}>
                  Skips Steam ID checks and focuses the report on the enemy team&apos;s setups, rotations, and tendencies.
                </p>
              </label>
            </div>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="text-center mt-3 text-sm" style={{ color: "var(--color-danger)" }}>
          {error}
        </p>
      )}
    </div>
  );
}
