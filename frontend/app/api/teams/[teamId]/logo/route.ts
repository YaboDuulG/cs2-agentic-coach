import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ teamId: string }> }
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { teamId } = await params;
  const formData = await req.formData();
  
  const res = await fetch(`${API_URL}/api/teams/${teamId}/logo?user_id=${userId}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.API_SHARED_SECRET}`,
    },
    body: formData,
  });
  
  return NextResponse.json(await res.json(), { status: res.status });
}
