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
  
  const xhrRef = useRef<XMLHttpRequest | null>(null);
  const startTimeRef = useRef<number>(0);

  const cancelUpload = () => {
    if (xhrRef.current) {
      xhrRef.current.abort();
      setUploading(false);
      setProgress(0);
      setBytesUploaded(0);
      setUploadSpeed(null);
      setError("Upload cancelled by user.");
    }
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

      // 1. Get presigned URL
      const presignRes = await fetch("/api/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: uploadName,
          size_bytes: uploadFile.size,
          team_id: teamId,
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

      // 2. Perform upload using XMLHttpRequest to track progress
      const xhr = new XMLHttpRequest();
      xhrRef.current = xhr;

      xhr.upload.addEventListener("progress", (event) => {
        if (event.lengthComputable) {
          const pct = Math.round((event.loaded / event.total) * 100);
          setProgress(pct);
          setBytesUploaded(event.loaded);
          
          // Calculate upload speed
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

      xhr.addEventListener("abort", () => {
        console.log("Upload aborted");
      });

      xhr.open("PUT", upload_url);
      xhr.setRequestHeader("Content-Type", "application/octet-stream");
      xhr.send(uploadFile);

    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed.");
      setUploading(false);
    }
  }, [router, onSuccess, teamId]);

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
        <div
          {...getRootProps()}
          className="relative cursor-pointer mx-auto transition-all duration-300 max-w-[540px]"
          style={{
            background: isDragActive ? "rgba(45,125,210,0.12)" : "rgba(13,24,37,0.85)",
            border: `2px dashed ${isDragActive ? "#2D7DD2" : "rgba(45,125,210,0.4)"}`,
            borderRadius: 16,
            padding: "40px 32px",
            backdropFilter: "blur(12px)",
            boxShadow: isDragActive ? "0 0 40px rgba(45,125,210,0.3)" : "0 8px 32px rgba(0,0,0,0.4)",
          }}
        >
          <div className="absolute top-0 left-0 right-0 h-0.5 rounded-t-[14px]"
            style={{ background: "linear-gradient(90deg, transparent, #2D7DD2, transparent)" }} />
          <input {...getInputProps()} />
          <div className="flex flex-col items-center gap-4">
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center"
              style={{ background: "rgba(45,125,210,0.15)", border: "1px solid rgba(45,125,210,0.3)" }}>
              <Upload size={28} color="#2D7DD2" />
            </div>
            <div className="text-center">
              <p style={{ color: "#F0F4FF", fontWeight: 600, marginBottom: 4 }}>
                {isDragActive ? "Drop your demo here" : "Drop your .dem file here"}
              </p>
              <p style={{ color: "#8BA7CC", fontSize: "0.85rem" }}>or click to browse — up to {MAX_MB}MB</p>
            </div>
          </div>
        </div>
      )}
      {error && <p className="text-center mt-3" style={{ color: "#FF4D6D", fontSize: "0.875rem" }}>{error}</p>}
    </div>
  );
}
