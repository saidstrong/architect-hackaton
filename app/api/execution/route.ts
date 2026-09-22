import { NextResponse } from "next/server";
import { getExecutionStatus, startExecution } from "@/lib/runtime";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(await getExecutionStatus());
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    if (body.mode !== undefined && body.mode !== "fix" && body.mode !== "milestone") throw new Error("Unsupported execution mode.");
    const state = await startExecution(body.mode === "fix" ? "fix" : "milestone");
    return NextResponse.json(state, { status: 202 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to start execution." }, { status: 400 });
  }
}
