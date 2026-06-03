"use client";

import { useCallback, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { useDropzone } from "react-dropzone";
import { Upload, X, Clock } from "lucide-react";
import { PLAN_LIMITS } from "@/lib/flags";

const MAX_MB = PLAN_LIMITS.free.maxFileSizeMB;
const MAX_BYTES = MAX_MB * 1024 * 1024;

interface UploadZoneProps {
  onSuccess?: () => void;
  teamId?: string;
}

export function UploadZone({ onSuccess, teamId }: UploadZoneProps) {
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
    setError("Upload cancelled by user.");
  };

  const onDrop = useCallback(async (accepted: File[]) => {
    const file = accepted[0];
    if (!file) return;
    if (!file.name.endsWith(".dem")) {
      setError("Only .dem files are supported.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError(`File too large. Max ${MAX_MB}MB.`);
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
        <div 
          className="relative mx-auto p-8 rounded-2xl border transition-all duration-300 max-w-[540px] text-center"
          style={{
            background: "rgba(13,24,37,0.92)",
            borderColor: "rgba(45,125,210,0.35)",
            boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
          }}
        >
          {/* Top Cancel button */}
          <button 
            onClick={cancelUpload}
            className="absolute top-4 right-4 p-1.5 rounded-full bg-slate-900 border border-white/5 hover:border-rose-500/40 text-slate-400 hover:text-white transition-all cursor-pointer"
            title="Cancel Upload"
          >
            <X size={14} />
          </button>

          <div className="flex flex-col items-center gap-6">
            {/* Spinning Ring */}
            <div className="relative flex items-center justify-center">
              <div className="w-16 h-16 rounded-full border-2 border-slate-800 border-t-[#2D7DD2] animate-spin" />
              <span className="absolute text-xs font-mono font-bold text-slate-300">
                {progress}%
              </span>
            </div>

            {/* Upload status text */}
            <div className="space-y-1.5">
              <h3 className="text-white font-bold text-sm tracking-wider">Uploading your demo…</h3>
              <p className="text-slate-400 text-xs font-mono">
                {formatMB(bytesUploaded)} MB / {formatMB(totalBytes)} MB
              </p>
            </div>

            {/* Progress bar */}
            <div className="w-full space-y-1">
              <div className="w-full h-1.5 rounded-full bg-slate-950/80 overflow-hidden p-0.5 border border-white/5">
                <div 
                  className="h-full rounded-full bg-gradient-to-r from-[#1B4F8A] to-[#2D7DD2] transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <div className="flex justify-between text-[9px] font-mono text-slate-500">
                <span className="flex items-center gap-1">
                  <Clock size={10} />
                  Speed: {uploadSpeed || "Calculating..."}
                </span>
                <span>*Do not close this window</span>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center">
          {/* Circular Compass Shield Dropzone */}
          <div
            {...getRootProps()}
            className="relative cursor-pointer mx-auto transition-all duration-300 rounded-full w-72 h-72 flex items-center justify-center overflow-hidden group select-none"
            style={{
              background: isDragActive ? "rgba(45,125,210,0.18)" : "rgba(13,24,37,0.85)",
              border: `2px solid ${isDragActive ? "#FFE135" : "rgba(45,125,210,0.4)"}`,
              backdropFilter: "blur(12px)",
              boxShadow: isDragActive ? "0 0 50px rgba(255,225,53,0.25)" : "0 8px 32px rgba(0,0,0,0.5)",
            }}
          >
            {/* Tactical Blueprint Grid Background */}
            <div className="absolute inset-0 pointer-events-none opacity-20 bg-[radial-gradient(circle_at_center,rgba(45,125,210,0.15)_0%,transparent_75%)] bg-[linear-gradient(rgba(255,255,255,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.05)_1px,transparent_1px)] bg-[size:16px_16px]" />

            {/* Slow-spinning decorative rings */}
            <div 
              className="absolute inset-2 border-2 border-dashed border-[#2D7DD2]/30 rounded-full animate-spin pointer-events-none" 
              style={{ animationDuration: "25s" }}
            />
            <div 
              className="absolute inset-6 border border-dotted border-[#C9A227]/40 rounded-full animate-spin pointer-events-none" 
              style={{ animationDuration: "40s", animationDirection: "reverse" }}
            />
            <div 
              className="absolute inset-10 border border-slate-800/40 rounded-full pointer-events-none" 
            />

            {/* Drag-over active glow */}
            {isDragActive && (
              <div className="absolute inset-0 bg-[#FFE135]/5 animate-pulse rounded-full pointer-events-none" />
            )}

            <input {...getInputProps()} />

            {/* Central elements */}
            <div className="relative z-10 flex flex-col items-center gap-3 text-center px-6">
              <div 
                className="w-14 h-14 rounded-full flex items-center justify-center transition-transform duration-300 group-hover:scale-105"
                style={{ 
                  background: isDragActive ? "rgba(255,225,53,0.15)" : "rgba(45,125,210,0.15)", 
                  border: isDragActive ? "1px solid rgba(255,225,53,0.35)" : "1px solid rgba(45,125,210,0.3)" 
                }}
              >
                <Upload size={22} className={isDragActive ? "text-[#FFE135] animate-bounce" : "text-[#2D7DD2]"} />
              </div>
              <div className="space-y-1">
                <p className="text-white font-bold text-sm tracking-wide">
                  {isDragActive ? "Scan the battlefield" : "Drop CS2 Demo"}
                </p>
                <p className="text-slate-400 text-[11px] leading-tight">
                  or click to upload<br />
                  <span className="font-mono text-slate-500">.dem (max {MAX_MB}MB)</span>
                </p>
              </div>
            </div>
          </div>

          {/* Ilchi Spy Scan Checkbox */}
          <div 
            className="mt-6 p-4 rounded-xl border transition-all duration-300 flex items-start gap-3 select-none w-full max-w-[480px]"
            style={{
              background: isRecon ? "rgba(201,162,39,0.06)" : "rgba(13,24,37,0.4)",
              borderColor: isRecon ? "rgba(201,162,39,0.35)" : "rgba(30,58,95,0.4)",
            }}
          >
            <input
              type="checkbox"
              id="is-recon-checkbox"
              checked={isRecon}
              onChange={(e) => setIsRecon(e.target.checked)}
              className="mt-1 w-4 h-4 rounded border-slate-700 bg-slate-900 text-[#C9A227] focus:ring-[#C9A227] cursor-pointer"
            />
            <label htmlFor="is-recon-checkbox" className="flex-1 text-left cursor-pointer select-none">
              <div className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                <span className={isRecon ? "text-[#C9A227]" : "text-slate-300"}>Ilchi Spy Scan (Opposition Research)</span>
                {isRecon && (
                  <span className="text-[9px] bg-[#C9A227]/20 text-[#C9A227] px-1.5 py-0.5 rounded font-mono font-bold uppercase tracking-wider animate-pulse">
                    Active
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-500 mt-1 leading-normal">
                Bypass standard Steam ID verification checks. Focus the Great Khan&apos;s AI strategy output on opposition layout trends, rotations, and performance profiles.
              </p>
            </label>
          </div>
        </div>
      )}
      {error && <p className="text-center mt-3" style={{ color: "#FF4D6D", fontSize: "0.875rem" }}>{error}</p>}
    </div>
  );
}
