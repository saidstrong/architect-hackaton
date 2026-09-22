import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { getProjectConfig, readProjectFile, writeProjectFile } from "@/lib/project";
import { runVerification } from "@/lib/verify";
import { readLastRun, sameRepo, writeLastRun } from "@/lib/last-run";
import { targetProcessEnv } from "@/lib/process";

export type Activity = {
  at: string;
  kind: "info" | "success" | "error" | "codex" | "verify";
  message: string;
};

export type ExecutionState = {
  running: boolean;
  blocked?: boolean;
  repoPath?: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  exitCode: number | null;
  verificationOk?: boolean | null;
  status?: "passed" | "failed" | null;
  activities: Activity[];
  finalMessage: string | null;
};

type RuntimeGlobal = typeof globalThis & { __architectExecution?: ExecutionState };
const g = globalThis as RuntimeGlobal;
const lockPath = path.join(process.cwd(), ".architect-runtime", "execution.lock");
const recoveryMessage = "A previous milestone run may still own Codex. Inspect .architect-runtime/execution.lock and the recorded process before clearing it.";

function initialState(): ExecutionState {
  return { running: false, repoPath: null, startedAt: null, finishedAt: null, exitCode: null, verificationOk: null, status: null, activities: [], finalMessage: null };
}
if (!g.__architectExecution) g.__architectExecution = initialState();

export function getExecutionState() {
  return g.__architectExecution!;
}

export async function getExecutionStatus(): Promise<ExecutionState> {
  let state = getExecutionState();
  if (state.running) return state;
  const config = await getProjectConfig();
  if (state.repoPath && (!config || !sameRepo(state.repoPath, config.repoPath))) {
    g.__architectExecution = initialState();
    state = getExecutionState();
  }
  if (!state.finishedAt && config) {
    const previous = await readLastRun(config.repoPath);
    if (previous) {
      Object.assign(state, {
        repoPath: previous.repoPath,
        startedAt: previous.startedAt,
        finishedAt: previous.finishedAt,
        exitCode: previous.codexExitCode,
        verificationOk: previous.verificationPassed,
        status: previous.status,
        finalMessage: previous.finalMessage,
      });
    }
  }
  const locked = await fs.stat(lockPath).then(() => true, () => false);
  return locked ? { ...state, blocked: true, finalMessage: recoveryMessage } : state;
}

async function acquireExecutionLock(repoPath: string) {
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  let handle: fs.FileHandle;
  try {
    handle = await fs.open(lockPath, "wx");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error(recoveryMessage);
    throw error;
  }
  try {
    await handle.writeFile(JSON.stringify({ serverPid: process.pid, repoPath, startedAt: new Date().toISOString() }, null, 2));
  } catch (error) {
    await handle.close();
    await fs.unlink(lockPath).catch(() => {});
    throw error;
  }
  await handle.close();
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

function summarizeCodexEvent(line: string): string | null {
  try {
    const event = JSON.parse(line) as {
      type?: string;
      message?: string;
      item?: { type?: string; text?: string; command?: string; exit_code?: number; changes?: { path?: string; kind?: string }[] };
    };
    const item = event.item;
    if (event.type === "item.completed" && item?.type === "agent_message" && item.text) return `Agent: ${item.text}`;
    if (item?.type === "command_execution" && item.command) {
      if (event.type === "item.started") return `Running: ${item.command.slice(0, 300)}`;
      if (event.type === "item.completed") return `Command exit ${item.exit_code ?? "?"}: ${item.command.slice(0, 300)}`;
    }
    if (event.type === "item.completed" && item?.type === "file_change") {
      const files = item.changes?.map((change) => change.path).filter(Boolean).slice(0, 8).join(", ");
      return files ? `Files changed: ${files}` : "File changes completed.";
    }
    if (event.type === "turn.completed") return "Codex turn completed.";
    if (event.type === "turn.failed" || event.type === "error") return `Codex error: ${event.message || line.slice(0, 500)}`;
    return null;
  } catch {
    return line.slice(0, 500);
  }
}

async function persistFinishedState(state: ExecutionState) {
  if (!state.repoPath || !state.startedAt || !state.finishedAt || !state.status || !state.finalMessage) return;
  await writeLastRun({
    repoPath: state.repoPath,
    startedAt: state.startedAt,
    finishedAt: state.finishedAt,
    codexExitCode: state.exitCode,
    verificationPassed: state.verificationOk === true,
    status: state.status,
    finalMessage: state.finalMessage,
  });
}

async function readExecutionPrompt(repoPath: string) {
  const state = (await readProjectFile("PROJECT_STATE.md", repoPath)) || "";
  const acceptance = (await readProjectFile("ACCEPTANCE.md", repoPath)) || "";
  const task = (await readProjectFile("TASK.md", repoPath)) || "";
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
- Install dependencies inside this repository using its package manifest and lockfile. Do not link node_modules to another repository; that makes builds and verification unreliable.
- Update .architect/PROJECT_STATE.md and .architect/reports/latest.md with factual results.
- Do not start the next milestone.
`;
}

export async function startExecution() {
  const state = getExecutionState();
  if (state.running) throw new Error("Codex is already running.");
  const config = await getProjectConfig();
  if (!config) throw new Error("No target repository selected.");
  await acquireExecutionLock(config.repoPath);

  state.running = true;
  state.repoPath = config.repoPath;
  state.startedAt = new Date().toISOString();
  state.finishedAt = null;
  state.exitCode = null;
  state.verificationOk = null;
  state.status = null;
  state.activities = [];
  state.finalMessage = null;
  push("info", "Starting Codex for the current milestone.");

  let prompt: string;
  let previousLatest: string | null;
  try {
    prompt = await readExecutionPrompt(config.repoPath);
    previousLatest = await readProjectFile("reports/latest.md", config.repoPath);
  } catch (error) {
    state.running = false;
    state.finishedAt = new Date().toISOString();
    state.exitCode = 1;
    state.status = "failed";
    state.finalMessage = "Unable to prepare the Codex run.";
    await persistFinishedState(state).catch((cause) => push("error", `Unable to save last-run status: ${String(cause)}`));
    await fs.unlink(lockPath).catch(() => {});
    throw error;
  }
  let child;
  try {
    // On Windows the CLI is usually a .cmd shim, so shell mode is necessary.
    // Keep project text out of shell arguments and send it over stdin instead.
    child = spawn("codex", ["exec", "--json", "--sandbox", "workspace-write", "-c", "sandbox_workspace_write.network_access=true", "-"], {
      cwd: config.repoPath,
      env: targetProcessEnv(),
      shell: process.platform === "win32",
      windowsHide: true,
    });
  } catch (error) {
    state.running = false;
    state.finishedAt = new Date().toISOString();
    state.exitCode = 1;
    state.status = "failed";
    state.finalMessage = "Unable to start Codex.";
    await persistFinishedState(state).catch((cause) => push("error", `Unable to save last-run status: ${String(cause)}`));
    await fs.unlink(lockPath).catch(() => {});
    throw error;
  }
  child.stdin?.on("error", (error) => push("error", `Unable to send Codex prompt: ${error.message}`));
  child.stdin?.end(prompt);

  let stdoutBuffer = "";
  let stderrBuffer = "";

  child.stdout?.on("data", (chunk) => {
    stdoutBuffer += chunk.toString();
    const lines = stdoutBuffer.split(/\r?\n/);
    stdoutBuffer = lines.pop() || "";
    for (const line of lines.filter(Boolean)) {
      const summary = summarizeCodexEvent(line);
      if (summary) push("codex", summary);
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
        const summary = summarizeCodexEvent(stdoutBuffer);
        if (summary) push("codex", summary);
      }
      if (stderrBuffer.trim()) push("codex", stderrBuffer);
      state.exitCode = code ?? 1;
      push(code === 0 ? "success" : "error", `Codex finished with exit code ${code ?? 1}.`);

      push("verify", "Running deterministic verification.");
      const verification = await runVerification(config.repoPath);
      state.verificationOk = verification.ok;
      for (const check of verification.checks) {
        push(check.ok ? "success" : "error", `${check.name}: ${check.ok ? "PASS" : "FAIL"}${check.detail ? " — " + check.detail : ""}`);
      }

      const codexReport = await readProjectFile("reports/latest.md", config.repoPath);
      const codexUpdated = Boolean(codexReport && codexReport !== previousLatest);
      if (codexUpdated) await writeProjectFile("reports/codex-latest.md", codexReport!, config.repoPath);

      const verificationReport = [
        "# Deterministic Verification",
        "",
        `Generated: ${new Date().toISOString()}`,
        `Codex exit code: ${code ?? 1}`,
        "",
        ...verification.checks.map((c) => `- [${c.ok ? "x" : " "}] ${c.name}${c.detail ? " — " + c.detail : ""}`),
        "",
      ].join("\n");
      await writeProjectFile("reports/verification-latest.md", verificationReport, config.repoPath);

      state.status = code === 0 && verification.ok ? "passed" : "failed";
      state.finalMessage = state.status === "passed" ? "Milestone execution finished and verification passed." : "Milestone execution finished with failures.";
      const summary = [
        "# Latest Execution",
        "",
        `Generated: ${new Date().toISOString()}`,
        `Status: ${state.status}`,
        `Codex exit code: ${code ?? 1}`,
        `Deterministic verification: ${verification.ok ? "passed" : "failed"}`,
        "",
        codexUpdated ? "Codex implementation details: [codex-latest.md](codex-latest.md)" : "Codex did not update its detailed report during this run.",
        "Verification details: [verification-latest.md](verification-latest.md)",
        "Final audit, if run: [audit-latest.md](audit-latest.md)",
        "",
      ].join("\n");
      await writeProjectFile("reports/latest.md", summary, config.repoPath);
    } catch (error) {
      state.status = "failed";
      push("error", error instanceof Error ? error.message : "Post-execution verification failed.");
      state.finalMessage = "Execution completed, but post-run processing failed.";
    } finally {
      state.running = false;
      state.finishedAt = new Date().toISOString();
      await persistFinishedState(state).catch((error) => {
        push("error", `Unable to save last-run status: ${String(error)}`);
        state.status = "failed";
        state.finalMessage = "Execution finished, but last-run status could not be saved.";
      });
      await fs.unlink(lockPath).catch(() => {});
    }
  });

  return getExecutionState();
}
