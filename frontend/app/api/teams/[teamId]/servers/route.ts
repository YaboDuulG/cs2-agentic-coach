import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ teamId: string }> }
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { teamId } = await params;
  try {
    const res = await fetch(`${API_URL}/api/teams/${teamId}/servers`, {
      headers: {
        "x-clerk-user-id": userId,
      },
      cache: "no-store",
    });
    
    let data;
    try {
      data = await res.json();
    } catch {
      data = { error: "Failed to parse API response as JSON", detail: res.statusText || "Internal Server Error" };
    }
    return NextResponse.json(data, { status: res.status });
  } catch (err: any) {
    return NextResponse.json({ error: "Failed to fetch from backend", detail: err.message }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ teamId: string }> }
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { teamId } = await params;
  
  let body;
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  try {
    const res = await fetch(`${API_URL}/api/teams/${teamId}/servers`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-clerk-user-id": userId,
      },
      body: JSON.stringify(body),
    });

    let data;
    try {
      data = await res.json();
    } catch {
      data = { error: "Failed to parse API response as JSON", detail: res.statusText || "Internal Server Error" };
    }
    return NextResponse.json(data, { status: res.status });
  } catch (err: any) {
    return NextResponse.json({ error: "Failed to fetch from backend", detail: err.message }, { status: 500 });
  }
}

