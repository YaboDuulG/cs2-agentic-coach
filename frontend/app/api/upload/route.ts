import { NextRequest, NextResponse } from "next/server";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

/**
 * POST /api/upload
 *
 * Step 1: Ask the FastAPI backend for a presigned GCS upload URL.
 * Step 2: Return the presigned URL + match_id to the browser.
 * Step 3: Browser uploads the .dem file DIRECTLY to GCS (no Vercel size limit).
 * Step 4: Browser calls POST /api/jobs/[match_id]/start to trigger Scout parsing.
 *
 * Why: Vercel serverless functions cap request bodies at 4.5MB.
 * CS2 demos are 200–800MB — they must bypass Vercel entirely.
 */
export async function POST(req: NextRequest) {
  try {
    const { filename, size_bytes } = await req.json();

    if (!filename || !filename.endsWith(".dem")) {
      return NextResponse.json({ error: "Only .dem files are accepted." }, { status: 400 });
    }

    // Request presigned URL from FastAPI backend
    const res = await fetch(`${API_URL}/api/upload/presign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename, size_bytes }),
    });

    const data = await res.json();
    if (!res.ok) {
      return NextResponse.json(data, { status: res.status });
    }

    // Returns { match_id, upload_url, gcs_path }
    return NextResponse.json({ job_id: data.match_id, ...data });
  } catch {
    return NextResponse.json({ error: "Failed to get upload URL" }, { status: 502 });
  }
}
