import { NextResponse } from "next/server";
import { getProjectConfig, writeProjectFile } from "@/lib/project";
import { getExecutionStatus } from "@/lib/runtime";
import { runVerification } from "@/lib/verify";

export const runtime = "nodejs";
export async function POST() {
  try {
    const config = await getProjectConfig();
    if (!config) throw new Error("No target repository selected.");
    const execution = await getExecutionStatus();
    if (execution.running || execution.blocked) throw new Error("Verification is unavailable while Codex is running or recovery is required.");
    const result = await runVerification(config.repoPath);
    const report = ["# Deterministic Verification", "", `Generated: ${new Date().toISOString()}`, "Source: Manual verification", "", ...result.checks.map(c => `- [${c.ok ? "x" : " "}] ${c.name}${c.detail ? " — " + c.detail : ""}`), ""].join("\n");
    await writeProjectFile("reports/verification-latest.md", report, config.repoPath);
    return NextResponse.json({ verification: result });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Verification failed." }, { status: 400 });
  }
}
