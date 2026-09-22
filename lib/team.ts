import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getProjectConfig } from "@/lib/project";
import { runCommand } from "@/lib/process";

const WorkerId = z.enum(["A", "B", "C"]);
const WorkerStatus = z.enum(["offline", "idle", "working", "verifying", "ready_for_review", "blocked"]);
const TaskStatus = z.enum(["queued", "ready", "working", "verifying", "ready_for_review", "integrated", "blocked", "failed", "stale"]);
const ShortText = z.string().trim().min(1).max(160);
const PathList = z.array(z.string().trim().min(1).max(180)).max(20);
const Capabilities = z.object({ codex:z.boolean().optional(), openaiApi:z.boolean().optional(), nvidiaApi:z.boolean().optional() }).strict();

export type WorkerId = z.infer<typeof WorkerId>;
export type WorkerStatus = z.infer<typeof WorkerStatus>;
export type TaskStatus = z.infer<typeof TaskStatus>;
export type Worker = {
  id: WorkerId; name: string; status: WorkerStatus; currentTaskId?: string; branch?: string;
  lastActivityAt?: string; capabilities: z.infer<typeof Capabilities>;
};
export type TeamTask = {
  id: string; title: string; objective: string; owner?: WorkerId; status: TaskStatus;
  branch: string; baseSha: string; dependencies: string[]; acceptance: string[];
  ownedPaths: string[]; avoidPaths: string[];
  verification?: { passed?: boolean; summary?: string }; latestCommit?: string;
  updatedAt: string;
};
export type TeamState = { version: 1; workers: Worker[]; tasks: TeamTask[] };
export type ScopeWarning = { path: string; reason: string; otherTaskId?: string };
export type TeamTaskView = TeamTask & {
  effectiveStatus: TaskStatus; waitingFor: string[]; staleBase: boolean;
  branchAvailable: boolean; changedPaths: string[]; scopeWarnings: ScopeWarning[];
};
export type TeamSnapshot = { workers: Worker[]; tasks: TeamTaskView[]; mainBranch: string; mainSha: string };

const WorkerSchema = z.object({
  id:WorkerId, name:ShortText, status:WorkerStatus, currentTaskId:z.string().optional(),
  branch:z.string().optional(), lastActivityAt:z.string().optional(), capabilities:Capabilities,
}).strict();
const TaskSchema = z.object({
  id:z.string().uuid(), title:ShortText, objective:z.string().trim().min(1).max(2000),
  owner:WorkerId.optional(), status:TaskStatus, branch:z.string().min(1).max(180),
  baseSha:z.string().regex(/^[0-9a-f]{40}$/), dependencies:z.array(z.string().uuid()).max(30),
  acceptance:z.array(ShortText).max(30), ownedPaths:PathList, avoidPaths:PathList,
  verification:z.object({ passed:z.boolean().optional(), summary:z.string().max(1000).optional() }).strict().optional(),
  latestCommit:z.string().regex(/^[0-9a-f]{7,40}$/).optional(), updatedAt:z.string(),
}).strict();
const TeamSchema = z.object({ version:z.literal(1), workers:z.array(WorkerSchema).length(3), tasks:z.array(TaskSchema).max(200) }).strict();
const CreateTask = z.object({
  title:ShortText, objective:z.string().trim().min(1).max(2000), owner:WorkerId.optional(),
  branch:z.string().trim().min(1).max(180), dependencies:z.array(z.string().uuid()).max(30).default([]),
  acceptance:z.array(ShortText).max(30).default([]), ownedPaths:PathList.default([]), avoidPaths:PathList.default([]),
}).strict();

function defaultState(): TeamState {
  return { version:1, workers:(["A", "B", "C"] as WorkerId[]).map(id => ({ id, name:`Worker ${id}`, status:"idle", capabilities:{} })), tasks:[] };
}
function assertNoCredential(value: unknown) {
  const serialized = JSON.stringify(value);
  if (/sk-[A-Za-z0-9_-]{12,}|(?:api[_-]?key|secret|token)\s*[=:]\s*["']?[A-Za-z0-9_-]{12,}/i.test(serialized)) {
    throw new Error("Team state cannot contain credential values.");
  }
}
async function selectedRepo() {
  const config = await getProjectConfig();
  if (!config) throw new Error("No target repository selected.");
  return config.repoPath;
}
function teamPath(repoPath: string) { return path.join(repoPath, ".architect", "team", "state.json"); }
async function readState(repoPath: string): Promise<TeamState> {
  try { return TeamSchema.parse(JSON.parse(await fs.readFile(teamPath(repoPath), "utf8"))) as TeamState; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return defaultState();
    throw new Error("Team state is invalid; inspect .architect/team/state.json before continuing.");
  }
}
async function writeState(repoPath: string, state: TeamState) {
  TeamSchema.parse(state);
  assertNoCredential(state);
  const target = teamPath(repoPath);
  await fs.mkdir(path.dirname(target), { recursive:true });
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, JSON.stringify(state, null, 2) + "\n", { encoding:"utf8", flag:"wx" });
    await fs.rename(temporary, target);
  } catch (error) { await fs.unlink(temporary).catch(() => {}); throw error; }
}

let mutationQueue: Promise<unknown> = Promise.resolve();
function mutate<T>(operation: () => Promise<T>): Promise<T> {
  const next = mutationQueue.then(operation, operation);
  mutationQueue = next.then(() => undefined, () => undefined);
  return next;
}
async function gitSha(repoPath: string, ref: string) {
  const result = await runCommand("git", ["rev-parse", "--verify", ref], repoPath);
  return result.exitCode === 0 && /^[0-9a-f]{40}$/i.test(result.stdout.trim()) ? result.stdout.trim().toLowerCase() : null;
}
async function mainRef(repoPath: string) {
  for (const branch of ["main", "master"]) {
    const ref = `refs/heads/${branch}`;
    const sha = await gitSha(repoPath, ref);
    if (sha) return { branch, ref, sha };
  }
  const sha = await gitSha(repoPath, "HEAD");
  if (!sha) throw new Error("Target repository has no commit to use as the task base.");
  return { branch:"current branch", ref:"HEAD", sha };
}
async function validateBranch(repoPath: string, branch: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(branch) || branch.includes("..") || branch.endsWith("/") || branch.endsWith(".lock") ||
      ["main", "master"].includes(branch) || /^worker-[abc]$/i.test(branch)) throw new Error("Use a task-specific Git branch name such as feature/core-analysis.");
  const check = await runCommand("git", ["check-ref-format", "--branch", branch], repoPath);
  if (check.exitCode !== 0) throw new Error("Invalid Git branch name.");
}
function dependenciesWaiting(task: TeamTask, tasks: TeamTask[]) {
  return task.dependencies.filter(id => tasks.find(candidate => candidate.id === id)?.status !== "integrated");
}
function assertWorkerCanStart(worker: Worker, task: TeamTask, tasks: TeamTask[]) {
  const current = tasks.find(item => item.id === worker.currentTaskId);
  if (current && current.id !== task.id && ["working", "verifying", "ready_for_review", "blocked"].includes(current.status)) {
    throw new Error(`${worker.name} already has an active task. Queue this task or reassign it.`);
  }
}
function globMatches(pattern: string, file: string) {
  const escaped = pattern.replace(/\\/g, "/").replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, "\u0000").replace(/\*/g, "[^/]*").replace(/\u0000/g, ".*");
  return new RegExp(`^${escaped}$`).test(file.replace(/\\/g, "/"));
}
function scopeWarnings(task: TeamTask, tasks: TeamTask[], files: string[]): ScopeWarning[] {
  const warnings: ScopeWarning[] = [];
  for (const file of files) {
    if (task.avoidPaths.some(pattern => globMatches(pattern, file))) warnings.push({ path:file, reason:"Task avoid path" });
    if (task.ownedPaths.length && !task.ownedPaths.some(pattern => globMatches(pattern, file))) warnings.push({ path:file, reason:"Outside task owned paths" });
    for (const other of tasks) {
      if (other.id !== task.id && !["integrated", "failed"].includes(other.status) && other.ownedPaths.some(pattern => globMatches(pattern, file))) {
        warnings.push({ path:file, reason:`Overlaps ${other.title}`, otherTaskId:other.id });
      }
    }
  }
  return warnings;
}
async function branchFiles(repoPath: string, task: TeamTask) {
  const local = `refs/heads/${task.branch}`;
  const remote = `refs/remotes/origin/${task.branch}`;
  const ref = await gitSha(repoPath, local) ? local : await gitSha(repoPath, remote) ? remote : null;
  if (!ref) return { available:false, files:[] as string[] };
  const diff = await runCommand("git", ["diff", "--name-only", `${task.baseSha}...${ref}`], repoPath);
  return { available:true, files:diff.exitCode === 0 ? diff.stdout.trim().split(/\r?\n/).filter(Boolean) : [] };
}
export async function getTeamSnapshot(): Promise<TeamSnapshot> {
  const repoPath = await selectedRepo();
  const [state, main] = await Promise.all([readState(repoPath), mainRef(repoPath)]);
  const tasks = await Promise.all(state.tasks.map(async task => {
    const waitingFor = dependenciesWaiting(task, state.tasks);
    const branch = await branchFiles(repoPath, task);
    return {
      ...task,
      effectiveStatus: task.status === "queued" && task.dependencies.length > 0 && !waitingFor.length ? "ready" as TaskStatus : task.status,
      waitingFor, staleBase: task.baseSha !== main.sha,
      branchAvailable:branch.available, changedPaths:branch.files,
      scopeWarnings:scopeWarnings(task, state.tasks, branch.files),
    };
  }));
  return { workers:state.workers, tasks, mainBranch:main.branch, mainSha:main.sha };
}

export async function updateWorker(input: unknown) {
  const update = z.object({ id:WorkerId, name:ShortText.optional(), status:WorkerStatus.optional(), capabilities:Capabilities.optional() }).strict().parse(input);
  assertNoCredential(update);
  return mutate(async () => {
    const repoPath = await selectedRepo();
    const state = await readState(repoPath);
    const worker = state.workers.find(item => item.id === update.id)!;
    if (update.name !== undefined) worker.name = update.name;
    if (update.status !== undefined) worker.status = update.status;
    if (update.capabilities !== undefined) worker.capabilities = update.capabilities;
    worker.lastActivityAt = new Date().toISOString();
    await writeState(repoPath, state);
    return getTeamSnapshot();
  });
}
export async function createTeamTask(input: unknown) {
  const data = CreateTask.parse(input);
  assertNoCredential(data);
  return mutate(async () => {
    const repoPath = await selectedRepo();
    const state = await readState(repoPath);
    await validateBranch(repoPath, data.branch);
    if (state.tasks.some(task => task.branch === data.branch)) throw new Error("A team task already owns this branch.");
    if (data.dependencies.some(id => !state.tasks.some(task => task.id === id))) throw new Error("Dependency task not found.");
    const main = await mainRef(repoPath);
    const task: TeamTask = { ...data, id:randomUUID(), baseSha:main.sha, status:data.dependencies.some(id => state.tasks.find(item => item.id === id)?.status !== "integrated") ? "queued" : "ready", updatedAt:new Date().toISOString() };
    state.tasks.push(task);
    if (task.owner) {
      const worker = state.workers.find(item => item.id === task.owner)!;
      if (!worker.currentTaskId) { worker.currentTaskId = task.id; worker.branch = task.branch; }
      worker.lastActivityAt = task.updatedAt;
    }
    await writeState(repoPath, state);
    return getTeamSnapshot();
  });
}
export async function updateTeamTask(input: unknown) {
  const data = z.object({ taskId:z.string().uuid(), owner:WorkerId.nullable().optional(), dependencies:z.array(z.string().uuid()).max(30).optional(), ownedPaths:PathList.optional(), avoidPaths:PathList.optional() }).strict().parse(input);
  assertNoCredential(data);
  return mutate(async () => {
    const repoPath = await selectedRepo();
    const state = await readState(repoPath);
    const task = state.tasks.find(item => item.id === data.taskId);
    if (!task) throw new Error("Team task not found.");
    if (task.status === "integrated") throw new Error("Integrated tasks are read-only.");
    if (data.dependencies) {
      if (["working", "verifying", "ready_for_review"].includes(task.status) && data.dependencies.some(id => state.tasks.find(item => item.id === id)?.status !== "integrated")) throw new Error("Active tasks cannot gain unfinished dependencies.");
      if (data.dependencies.includes(task.id) || data.dependencies.some(id => !state.tasks.some(item => item.id === id))) throw new Error("Invalid task dependency.");
      const visits = new Set<string>();
      const hasCycle = (id: string): boolean => {
        if (id === task.id) return true;
        if (visits.has(id)) return false;
        visits.add(id);
        return (state.tasks.find(item => item.id === id)?.dependencies || []).some(hasCycle);
      };
      if (data.dependencies.some(hasCycle)) throw new Error("Task dependencies cannot form a cycle.");
      task.dependencies = [...new Set(data.dependencies)];
      if (dependenciesWaiting(task, state.tasks).length && task.status === "ready") task.status = "queued";
      if (task.dependencies.length && !dependenciesWaiting(task, state.tasks).length && task.status === "queued") task.status = "ready";
    }
    if (data.ownedPaths) task.ownedPaths = data.ownedPaths;
    if (data.avoidPaths) task.avoidPaths = data.avoidPaths;
    if (data.owner !== undefined) {
      for (const worker of state.workers) if (worker.currentTaskId === task.id) { delete worker.currentTaskId; delete worker.branch; if (worker.status !== "offline") worker.status = "idle"; }
      if (data.owner === null) delete task.owner;
      else {
        task.owner = data.owner;
        const worker = state.workers.find(item => item.id === data.owner)!;
        if (["working", "verifying", "ready_for_review", "blocked"].includes(task.status)) assertWorkerCanStart(worker, task, state.tasks);
        if (!worker.currentTaskId || ["working", "verifying", "ready_for_review", "blocked"].includes(task.status)) { worker.currentTaskId = task.id; worker.branch = task.branch; }
        if (["working", "verifying", "ready_for_review", "blocked"].includes(task.status)) worker.status = task.status as WorkerStatus;
        worker.lastActivityAt = new Date().toISOString();
      }
    }
    task.updatedAt = new Date().toISOString();
    await writeState(repoPath, state);
    return getTeamSnapshot();
  });
}
export async function setTeamTaskStatus(input: unknown) {
  const data = z.object({ taskId:z.string().uuid(), status:TaskStatus.exclude(["integrated"]) }).strict().parse(input);
  return mutate(async () => {
    const repoPath = await selectedRepo();
    const state = await readState(repoPath);
    const task = state.tasks.find(item => item.id === data.taskId);
    if (!task) throw new Error("Team task not found.");
    if (task.status === "integrated") throw new Error("Integrated tasks are read-only.");
    if (["working", "verifying", "ready_for_review"].includes(data.status) && !task.owner) throw new Error("Assign a worker before starting this task.");
    if (["ready", "working", "verifying", "ready_for_review"].includes(data.status) && dependenciesWaiting(task, state.tasks).length) throw new Error("Integrate dependencies before starting this task.");
    if (task.owner && ["working", "verifying", "ready_for_review", "blocked"].includes(data.status)) assertWorkerCanStart(state.workers.find(item => item.id === task.owner)!, task, state.tasks);
    task.status = data.status;
    task.updatedAt = new Date().toISOString();
    if (task.owner) {
      const worker = state.workers.find(item => item.id === task.owner)!;
      if (["working", "verifying", "ready_for_review", "blocked"].includes(data.status)) {
        worker.status = data.status as WorkerStatus; worker.currentTaskId = task.id; worker.branch = task.branch;
      } else if (worker.currentTaskId === task.id) {
        worker.status = "idle";
        if (data.status === "failed") { delete worker.currentTaskId; delete worker.branch; }
      }
      worker.lastActivityAt = task.updatedAt;
    }
    await writeState(repoPath, state);
    return getTeamSnapshot();
  });
}
export async function recordTeamResult(input: unknown) {
  const data = z.object({ taskId:z.string().uuid(), latestCommit:z.string().regex(/^[0-9a-f]{7,40}$/).optional(), passed:z.boolean().optional(), summary:z.string().trim().max(1000).optional() }).strict().parse(input);
  assertNoCredential(data);
  return mutate(async () => {
    const repoPath = await selectedRepo();
    const state = await readState(repoPath);
    const task = state.tasks.find(item => item.id === data.taskId);
    if (!task || task.status === "integrated") throw new Error("Editable team task not found.");
    if (data.latestCommit !== undefined) task.latestCommit = data.latestCommit;
    if (data.passed !== undefined || data.summary !== undefined) task.verification = { ...task.verification, ...(data.passed !== undefined ? { passed:data.passed } : {}), ...(data.summary !== undefined ? { summary:data.summary } : {}) };
    task.updatedAt = new Date().toISOString();
    await writeState(repoPath, state);
    return getTeamSnapshot();
  });
}
export async function markTeamTaskIntegrated(input: unknown) {
  const { taskId } = z.object({ taskId:z.string().uuid() }).strict().parse(input);
  return mutate(async () => {
    const repoPath = await selectedRepo();
    const state = await readState(repoPath);
    const task = state.tasks.find(item => item.id === taskId);
    if (!task || task.status !== "ready_for_review") throw new Error("Task must be ready for review first.");
    if (task.verification?.passed !== true) throw new Error("Record a passing verification result before integration.");
    if (!task.latestCommit || task.latestCommit === task.baseSha || task.baseSha.startsWith(task.latestCommit)) throw new Error("Record a task commit beyond the base SHA.");
    const main = await mainRef(repoPath);
    const local = `refs/heads/${task.branch}`;
    const remote = `refs/remotes/origin/${task.branch}`;
    const branch = await gitSha(repoPath, local) ? local : await gitSha(repoPath, remote) ? remote : null;
    if (!branch) throw new Error("Task branch is unavailable locally. Fetch it before marking integrated.");
    const fromBase = await runCommand("git", ["merge-base", "--is-ancestor", task.baseSha, task.latestCommit], repoPath);
    const onBranch = await runCommand("git", ["merge-base", "--is-ancestor", task.latestCommit, branch], repoPath);
    if (fromBase.exitCode !== 0 || onBranch.exitCode !== 0) throw new Error("Reported commit must be on the task branch after its base SHA.");
    const merged = await runCommand("git", ["merge-base", "--is-ancestor", task.latestCommit, main.ref], repoPath);
    if (merged.exitCode !== 0) throw new Error("Task commit is not on local main. Merge manually, then mark integrated.");
    task.status = "integrated";
    task.updatedAt = new Date().toISOString();
    for (const waitingTask of state.tasks) {
      if (waitingTask.status === "queued" && waitingTask.dependencies.includes(task.id) && !dependenciesWaiting(waitingTask, state.tasks).length) {
        waitingTask.status = "ready";
        waitingTask.updatedAt = task.updatedAt;
      }
    }
    if (task.owner) {
      const worker = state.workers.find(item => item.id === task.owner)!;
      if (worker.currentTaskId === task.id) { delete worker.currentTaskId; delete worker.branch; if (worker.status !== "offline") worker.status = "idle"; }
      worker.lastActivityAt = task.updatedAt;
    }
    await writeState(repoPath, state);
    return getTeamSnapshot();
  });
}
