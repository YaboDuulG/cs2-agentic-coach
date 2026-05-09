import { NextRequest, NextResponse } from "next/server";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export async function POST(req: NextRequest) {
  try {
    const body = await req.formData();
    const res = await fetch(`${API_URL}/upload`, {
      method: "POST",
      body,
    });
    const data = await res.json();
    if (!res.ok) {
      return NextResponse.json(data, { status: res.status });
    }
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: "Upload proxy failed" }, { status: 502 });
  }
}
