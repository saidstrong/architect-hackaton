import { NextResponse } from "next/server";
import { getExecutionState, startExecution } from "@/lib/runtime";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(getExecutionState());
}

export async function POST() {
  try {
    const state = await startExecution();
    return NextResponse.json(state, { status: 202 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to start execution." }, { status: 400 });
  }
}
