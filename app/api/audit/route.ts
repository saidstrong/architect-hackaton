import { NextResponse } from "next/server";
import { runAudit } from "@/lib/audit";

export const runtime = "nodejs";

export async function POST() {
  try {
    return NextResponse.json({ audit: await runAudit() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Audit failed." }, { status: 400 });
  }
}
