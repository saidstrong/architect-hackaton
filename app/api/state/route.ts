import { NextResponse } from "next/server";
import { readProjectFile, writeProjectFile } from "@/lib/project";

export const runtime = "nodejs";

const allowed = new Set(["TASK.md","ARCHITECTURE.md","PROJECT_STATE.md","ACCEPTANCE.md","DECISIONS.md","HOURLY_LOG.md","reports/latest.md"]);

export async function GET(request: Request) {
  const url = new URL(request.url);
  const file = url.searchParams.get("file") || "PROJECT_STATE.md";
  if (!allowed.has(file)) return NextResponse.json({ error: "Unsupported file." }, { status: 400 });
  return NextResponse.json({ file, content: await readProjectFile(file) });
}

export async function POST(request: Request) {
  try {
    const { file, content } = await request.json();
    if (!allowed.has(file) || typeof content !== "string") throw new Error("Invalid state update.");
    await writeProjectFile(file, content);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to save." }, { status: 400 });
  }
}
