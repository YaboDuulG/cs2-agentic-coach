import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/server/admin";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export async function GET() {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.response;

  try {
    const res = await fetch(`${API_URL}/api/admin/configs`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${process.env.API_SHARED_SECRET}`,
      },
    });

    const data = await res.json();
    if (!res.ok) {
      return NextResponse.json(data, { status: res.status });
    }
    return NextResponse.json(data);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : "Failed to fetch configs";
    return NextResponse.json({ error: errorMsg }, { status: 502 });
  }
}

export async function POST(req: NextRequest) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.response;

  try {
    const body = await req.json();
    const res = await fetch(`${API_URL}/api/admin/configs`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.API_SHARED_SECRET}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const data = await res.json();
    if (!res.ok) {
      return NextResponse.json(data, { status: res.status });
    }
    return NextResponse.json(data);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : "Failed to update configs";
    return NextResponse.json({ error: errorMsg }, { status: 502 });
  }
}
