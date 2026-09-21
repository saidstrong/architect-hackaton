import { NextResponse } from "next/server";
import { getRequests, resolveRequest } from "@/lib/requests";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ requests: await getRequests() });
}

export async function DELETE(request: Request) {
  try {
    const { file } = await request.json();
    await resolveRequest(file);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to resolve request." }, { status: 400 });
  }
}
