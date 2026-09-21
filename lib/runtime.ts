import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { getProjectConfig, readProjectFile, writeProjectFile } from "@/lib/project";
import { runVerification } from "@/lib/verify";

export type Activity = {
  at: string;
  kind: "info" | "success" | "error" | "codex" | "verify";
  message: string;
};

export type ExecutionState = {
  running: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  exitCode: number | null;
  activities: Activity[];
  finalMessage: string | null;
};

type RuntimeGlobal = typeof globalThis & { __architectExecution?: ExecutionState };
const g = globalThis as RuntimeGlobal;

function initialState(): ExecutionState {
  return { running: false, startedAt: null, finishedAt: null, exitCode: null, activities: [], finalMessage: null };
}
if (!g.__architectExecution) g.__architectExecution = initialState();

export function getExecutionState() {
  return g.__architectExecution!;
}

function push(kind: Activity["kind"], message: string) {
  const state = getExecutionState();
  state.activities.push({ at: new Date().toISOString(), kind, message: sanitize(message).slice(0, 1800) });
  if (state.activities.length > 300) state.activities.splice(0, state.activities.length - 300);
}

function sanitize(input: string) {
  return input
    .replace(/(sk-[A-Za-z0-9_-]{12,})/g, "[REDACTED_API_KEY]")
    .replace(/((?:API|SECRET|TOKEN|KEY)[A-Z0-9_]*\s*[=:]\s*)[^\s]+/gi, "$1[REDACTED]");
}

function summarizeCodexEvent(line: string) {
  try {
    const e = JSON.parse(line);
    const type = String(e.type || e.event || "event");
    const msg =
      e.message?.content?.[0]?.text ||
      e.message?.content ||
      e.item?.text ||
      e.text ||
      e.command ||
      e.status ||
      "";
    return msg ? `${type}: ${typeof msg === "string" ? msg : JSON.stringify(msg)}` : type;
  } catch {
    return line;
  }
}

async function readExecutionPrompt() {
  const state = (await readProjectFile("PROJECT_STATE.md")) || "";
  const acceptance = (await readProjectFile("ACCEPTANCE.md")) || "";
  const task = (await readProjectFile("TASK.md")) || "";
  return `You are the implementation agent for a time-boxed hackathon project.

Read AGENTS.md and the .architect directory before changing code.

CURRENT TASK:
${task}

CURRENT PROJECT STATE:
${state}

CURRENT ACCEPTANCE CRITERIA:
${acceptance}

Rules:
- Implement ONLY the current milestone in PROJECT_STATE.md.
- Optimize for a working end-to-end workflow, reliability, reproducibility, and task compliance.
- Do not introduce a new database, external service, framework, paid resource, or major architecture change without approval.
- If a new secret/environment variable is required, DO NOT invent it and DO NOT put secret values in markdown or logs. Create .architect/requests/secret-<NAME>.json containing {"type":"secret","name":"<NAME>","reason":"...","required":true}, then continue any work that is not blocked by it.
- If a major architecture decision is required, create .architect/requests/approval-<short-name>.json describing the decision and stop that part of the work.
- Run relevant tests as you work.
- Update .architect/PROJECT_STATE.md and .architect/reports/latest.md with factual results.
- Do not start the next milestone.
`;
}

export async function startExecution() {
  const state = getExecutionState();
  if (state.running) throw new Error("Codex is already running.");
  const config = await getProjectConfig();
  if (!config) throw new Error("No target repository selected.");

  state.running = true;
  state.startedAt = new Date().toISOString();
  state.finishedAt = null;
  state.exitCode = null;
  state.activities = [];
  state.finalMessage = null;
  push("info", "Starting Codex for the current milestone.");

  const prompt = await readExecutionPrompt();
  const child = spawn("codex", ["exec", "--json", "--sandbox", "workspace-write", prompt], {
    cwd: config.repoPath,
    env: process.env,
    shell: process.platform === "win32",
    windowsHide: true,
  });

  let stdoutBuffer = "";
  let stderrBuffer = "";
  let finalOutput = "";

  child.stdout?.on("data", (chunk) => {
    stdoutBuffer += chunk.toString();
    const lines = stdoutBuffer.split(/\r?\n/);
    stdoutBuffer = lines.pop() || "";
    for (const line of lines.filter(Boolean)) {
      const summary = summarizeCodexEvent(line);
      push("codex", summary);
      finalOutput += line + "\n";
    }
  });

  child.stderr?.on("data", (chunk) => {
    stderrBuffer += chunk.toString();
    const lines = stderrBuffer.split(/\r?\n/);
    stderrBuffer = lines.pop() || "";
    for (const line of lines.filter(Boolean)) push("codex", line);
  });

  child.on("error", (error) => {
    push("error", `Unable to start Codex: ${error.message}`);
  });

  child.on("close", async (code) => {
    try {
      if (stdoutBuffer.trim()) {
        push("codex", summarizeCodexEvent(stdoutBuffer));
        finalOutput += stdoutBuffer;
      }
      if (stderrBuffer.trim()) push("codex", stderrBuffer);
      state.exitCode = code ?? 1;
      push(code === 0 ? "success" : "error", `Codex finished with exit code ${code ?? 1}.`);

      push("verify", "Running deterministic verification.");
      const verification = await runVerification(config.repoPath);
      for (const check of verification.checks) {
        push(check.ok ? "success" : "error", `${check.name}: ${check.ok ? "PASS" : "FAIL"}${check.detail ? " — " + check.detail : ""}`);
      }

      const report = [
        "# Latest Execution Report",
        "",
        `Generated: ${new Date().toISOString()}`,
        `Codex exit code: ${code ?? 1}`,
        "",
        "## Verification",
        ...verification.checks.map((c) => `- [${c.ok ? "x" : " "}] ${c.name}${c.detail ? " — " + c.detail : ""}`),
        "",
        "## Notes",
        "See the dashboard Activity view for the structured Codex event stream.",
        "",
      ].join("\n");
      await writeProjectFile("reports/latest.md", report);
      state.finalMessage = verification.ok ? "Milestone execution finished and verification passed." : "Milestone execution finished with verification failures.";
    } catch (error) {
      push("error", error instanceof Error ? error.message : "Post-execution verification failed.");
      state.finalMessage = "Execution completed, but post-run processing failed.";
    } finally {
      state.running = false;
      state.finishedAt = new Date().toISOString();
    }
  });

  return getExecutionState();
}
