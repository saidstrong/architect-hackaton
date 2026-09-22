import { NextResponse } from "next/server";
import { listChanges, proposeChange, decideChange } from "@/lib/changes";
import { getExecutionStatus } from "@/lib/runtime";

export const runtime = "nodejs";
export async function GET() { return NextResponse.json({ changes: await listChanges() }); }
export async function POST(request: Request) {
  try {
    const body = await request.json();
    if (body.action === "propose" && typeof body.text === "string") return NextResponse.json({ change: await proposeChange(body.text) });
    if (body.action === "decide" && typeof body.id === "string" && ["Approved", "Deferred", "Rejected"].includes(body.status)) {
      const execution = await getExecutionStatus();
      return NextResponse.json({ change: await decideChange(body.id, body.status, execution.running || Boolean(execution.blocked)) });
    }
    throw new Error("Invalid change request.");
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to update change." }, { status: 400 });
  }
}
