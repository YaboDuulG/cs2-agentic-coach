"use client";

import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import { PLAN_LIMITS } from "@/lib/flags";

/**
 * The upload pipeline as a hook: fingerprint → gzip in the browser → presign
 * (dedupe) → chunked PUTs to GCS → compose/complete → navigate to the
 * debrief. Ported from the original UploadZone unchanged in behaviour; the
 * mode (team / scouting) is a parameter now instead of component state.
 */

export type UploadPhase = "idle" | "preparing" | "compressing" | "uploading" | "finalizing" | "done" | "error";

export interface UploadTarget {
  teamId?: string | null;
  isRecon?: boolean;
}

export interface UploadState {
  phase: UploadPhase;
  progress: number; // 0..100
  bytesUploaded: number;
  totalBytes: number;
  speed: string | null;
  error: string | null;
}

const MAX_BYTES = PLAN_LIMITS.free.maxFileSizeMB * 1024 * 1024;

// Cheap content identity so ten teammates uploading the same demo store,
// upload, and parse it once: size + SHA-256 of the first and last megabyte.
async function computeFingerprint(file: File): Promise<string | null> {
  try {
    const MB = 1024 * 1024;
    const hash = async (buf: ArrayBuffer) =>
      Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", buf)))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    const head = await hash(await file.slice(0, MB).arrayBuffer());
    const tail = await hash(await file.slice(Math.max(0, file.size - MB)).arrayBuffer());
    return `${file.size}:${head}:${tail}`;
  } catch {
    return null;
  }
}

async function presign(body: Record<string, unknown>) {
  const res = await fetch("/api/upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    if (res.status === 429) throw new Error(`You've used this month's uploads. ${err.detail ?? "Upgrade to keep going."}`);
    if (res.status === 402) throw new Error(err.detail?.message ?? err.detail ?? "This upload needs a higher plan.");
    throw new Error(typeof err.detail === "string" ? err.detail : "Could not start the upload.");
  }
  return res.json();
}

function putChunk(url: string, blob: Blob, onProgress: (loaded: number) => void, register: (x: XMLHttpRequest) => void) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    register(xhr);
    xhr.upload.addEventListener("progress", (e) => e.lengthComputable && onProgress(e.loaded));
    xhr.addEventListener("load", () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed (${xhr.status}).`))));
    xhr.addEventListener("error", () => reject(new Error("Network error during upload.")));
    xhr.addEventListener("abort", () => reject(new Error("Upload cancelled.")));
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.send(blob);
  });
}

export function useDemoUpload(onSuccess?: () => void) {
  const router = useRouter();
  const [state, setState] = useState<UploadState>({ phase: "idle", progress: 0, bytesUploaded: 0, totalBytes: 0, speed: null, error: null });
  const xhrs = useRef<XMLHttpRequest[]>([]);
  const started = useRef(0);

  const patch = (p: Partial<UploadState>) => setState((s) => ({ ...s, ...p }));

  const cancel = useCallback(() => {
    xhrs.current.forEach((x) => x.abort());
    xhrs.current = [];
    setState({ phase: "error", progress: 0, bytesUploaded: 0, totalBytes: 0, speed: null, error: "Upload cancelled." });
  }, []);

  const reset = useCallback(() => {
    setState({ phase: "idle", progress: 0, bytesUploaded: 0, totalBytes: 0, speed: null, error: null });
  }, []);

  const upload = useCallback(
    async (file: File, target: UploadTarget) => {
      if (!file.name.toLowerCase().endsWith(".dem")) {
        patch({ phase: "error", error: "This isn't a CS2 demo (.dem). Export it from your match history and try again." });
        return;
      }
      if (file.size > MAX_BYTES) {
        patch({ phase: "error", error: `This file is over the ${PLAN_LIMITS.free.maxFileSizeMB} MB limit.` });
        return;
      }

      setState({ phase: "preparing", progress: 0, bytesUploaded: 0, totalBytes: 0, speed: null, error: null });
      try {
        const fingerprint = await computeFingerprint(file);

        let blob: Blob = file;
        let name = file.name;
        if (typeof CompressionStream !== "undefined") {
          try {
            patch({ phase: "compressing" });
            blob = await new Response(file.stream().pipeThrough(new CompressionStream("gzip"))).blob();
            name = `${file.name}.gz`;
          } catch {
            blob = file;
          }
        }
        patch({ phase: "uploading", totalBytes: blob.size });
        started.current = Date.now();

        // GCS compose caps at 32 parts.
        let chunkSize = 5 * 1024 * 1024;
        let chunkCount = Math.ceil(blob.size / chunkSize);
        if (chunkCount > 32) {
          chunkSize = Math.ceil(blob.size / 32);
          chunkCount = 32;
        }

        const presigned = await presign({
          filename: name,
          size_bytes: blob.size,
          team_id: target.teamId ?? undefined,
          chunk_count: chunkCount,
          is_recon: Boolean(target.isRecon),
          fingerprint,
        });
        if (presigned.duplicate) {
          patch({ phase: "done", progress: 100 });
          onSuccess?.();
          router.push(`/analysis/${presigned.match_id}`);
          return { matchId: presigned.match_id as string, duplicate: true };
        }
        const jobId = presigned.job_id as string;

        const loaded = new Array<number>(chunkCount).fill(0);
        const report = () => {
          const total = loaded.reduce((a, b) => a + b, 0);
          const elapsed = Date.now() - started.current;
          patch({
            progress: Math.min(99, Math.round((total / blob.size) * 100)),
            bytesUploaded: total,
            speed: elapsed > 500 ? `${(total / elapsed / 1024).toFixed(1)} MB/s` : null,
          });
        };
        xhrs.current = [];

        if (chunkCount > 1) {
          const urls: string[] = presigned.upload_urls;
          await Promise.all(
            urls.map((url, i) =>
              putChunk(
                url,
                blob.slice(i * chunkSize, Math.min((i + 1) * chunkSize, blob.size)),
                (n) => {
                  loaded[i] = n;
                  report();
                },
                (x) => xhrs.current.push(x),
              ),
            ),
          );
          patch({ phase: "finalizing" });
          const compose = await fetch("/api/upload/compose", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ match_id: jobId, filename: name, chunk_count: chunkCount, team_id: target.teamId ?? undefined }),
          });
          if (!compose.ok) {
            const err = await compose.json().catch(() => ({}));
            throw new Error(typeof err.detail === "string" ? err.detail : "Could not finalize the upload.");
          }
        } else {
          await putChunk(
            presigned.upload_url,
            blob,
            (n) => {
              loaded[0] = n;
              report();
            },
            (x) => xhrs.current.push(x),
          );
          patch({ phase: "finalizing" });
          await fetch("/api/upload/complete", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ match_id: jobId }),
          }).catch(() => undefined);
        }

        patch({ phase: "done", progress: 100 });
        onSuccess?.();
        router.push(`/analysis/${jobId}`);
        return { matchId: jobId, duplicate: false };
      } catch (e) {
        patch({ phase: "error", error: e instanceof Error ? e.message : "Upload failed." });
        return null;
      }
    },
    [router, onSuccess],
  );

  return { state, upload, cancel, reset };
}
