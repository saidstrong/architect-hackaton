import { NextResponse } from "next/server";
import { captureEvidence, listEvidence } from "@/lib/evidence";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ evidence: await listEvidence() });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    return NextResponse.json({ evidence: await captureEvidence(body) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to capture evidence.";
    const hint = /Executable doesn't exist|browserType.launch/.test(message)
      ? " Install Chromium once with: npx playwright install chromium"
      : "";
    return NextResponse.json({ error: message + hint }, { status: 400 });
  }
}
