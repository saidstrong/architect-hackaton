import fs from "node:fs/promises";
import path from "node:path";
import { getProjectConfig, readProjectFile, writeProjectFile } from "@/lib/project";
import { getHackathonTimer } from "@/lib/hackathon-timer";
import { getTeamSnapshot } from "@/lib/team";

export type ChangeStatus = "Pending" | "Approved" | "Deferred" | "Rejected";
export type ChangeProposal = {
  id: string; repoPath: string; text: string; title: string; status: ChangeStatus; createdAt: string;
  currentMilestone: string; placement: string; impact: string; complexity: "Small" | "Medium" | "Large";
  newDependency: string; architectureChange: string; deadlineRisk: "Low" | "Medium" | "High";
  recommendation: string;
  teamImpact?: {
    workers: { id:string; name:string; status:string; task:string }[];
    affectedTasks: { id:string; title:string; status:string }[];
    unaffectedTasks: string[];
    suggestion: string;
  };
};
const changesPath = path.join(process.cwd(), ".architect-runtime", "changes.json");

async function allChanges(): Promise<ChangeProposal[]> {
  try {
    const value: unknown = JSON.parse(await fs.readFile(changesPath, "utf8"));
    return Array.isArray(value) ? value as ChangeProposal[] : [];
  } catch { return []; }
}
async function saveChanges(items: ChangeProposal[]) {
  await fs.mkdir(path.dirname(changesPath), { recursive: true });
  await fs.writeFile(changesPath, JSON.stringify(items, null, 2), "utf8");
}
export async function listChanges() {
  const config = await getProjectConfig();
  return config ? (await allChanges()).filter(item => item.repoPath === config.repoPath) : [];
}
function section(markdown: string, title: string) {
  const match = markdown.match(new RegExp(`^## ${title}\\s*\\r?\\n([^\\r\\n]+)`, "im"));
  return match?.[1]?.trim() || "Current milestone not specified";
}
function safeTitle(text: string) {
  return text.replace(/\s+/g, " ").replace(/[\r\n#*]/g, " ").trim().slice(0, 90);
}

export async function proposeChange(text: string, teamMode = false): Promise<ChangeProposal> {
  const config = await getProjectConfig();
  if (!config) throw new Error("No target repository selected.");
  const idea = text.trim();
  if (idea.length < 8 || idea.length > 800) throw new Error("Describe the idea in 8–800 characters.");
  if (/sk-[A-Za-z0-9_-]{12,}|(?:api[_-]?key|secret|token)\s*[=:]\s*["']?[A-Za-z0-9_-]{12,}/i.test(idea)) throw new Error("Remove credential values before evaluating the idea.");
  const state = await readProjectFile("PROJECT_STATE.md", config.repoPath) || "";
  const task = await readProjectFile("TASK.md", config.repoPath) || "";
  const acceptance = await readProjectFile("ACCEPTANCE.md", config.repoPath) || "";
  const timer = await getHackathonTimer();
  const remainingHours = timer ? (Date.parse(timer.endsAt) - Date.now()) / 3_600_000 : null;
  const currentMilestone = section(state, "Current milestone");
  const architectureChange = /architecture|framework|database|auth|backend|supabase|cloud|service/i.test(idea) ? "Likely; review before applying" : "Not apparent from description";
  const newDependency = /install|package|library|api|service|database|supabase|stripe|openai/i.test(idea) ? "Possible; confirm during scoping" : "Not apparent from description";
  const complexity = architectureChange.startsWith("Likely") ? "Large" : /simple|copy|label|text/i.test(idea) ? "Small" : "Medium";
  const deadlineRisk = remainingHours !== null && remainingHours <= 1 ? "High" : remainingHours !== null && remainingHours <= 2 ? "Medium" : architectureChange.startsWith("Likely") ? "High" : "Low";
  const title = safeTitle(idea);
  const proposal: ChangeProposal = {
    id: crypto.randomUUID(), repoPath: config.repoPath, text: idea, title, status: "Pending", createdAt: new Date().toISOString(),
    currentMilestone, placement: `After ${currentMilestone.split(/[—–-]/)[0].trim()} — choose a later milestone during planning`,
    impact: task.toLowerCase().includes(idea.toLowerCase()) || acceptance.toLowerCase().includes(idea.toLowerCase()) ? "Potential task alignment; confirm value" : "Demo value unvalidated",
    complexity, newDependency, architectureChange, deadlineRisk,
    recommendation: "Finish the current milestone. Review this idea for a later milestone; no active work is interrupted.",
  };
  if (teamMode) {
    const team = await getTeamSnapshot();
    const words = new Set(idea.toLowerCase().match(/[a-z]{3,}/g)?.filter(word => !["add", "the", "for", "with", "after", "later", "replace", "from", "into", "task", "feature"].includes(word)) || []);
    const affected = team.tasks.filter(task => task.status !== "integrated" && [...words].some(word => `${task.title} ${task.objective}`.toLowerCase().includes(word)));
    const free = team.workers.find(worker => worker.status === "idle" && !worker.currentTaskId);
    proposal.teamImpact = {
      workers:team.workers.map(worker => ({ id:worker.id, name:worker.name, status:worker.status, task:team.tasks.find(task => task.id === worker.currentTaskId)?.title || "No current task" })),
      affectedTasks:affected.map(task => ({ id:task.id, title:task.title, status:task.status })),
      unaffectedTasks:team.tasks.filter(task => !affected.includes(task)).map(task => task.title),
      suggestion: affected.length && /\b(?:replace|remove|cancel)\b/i.test(idea)
        ? "Review affected assignments. Defer or replace tasks manually after approval; no task is cancelled automatically."
        : free ? `Queue a scoped task for ${free.name} after approval; confirm dependencies before work starts.`
        : "Queue a scoped task after current assignments; confirm owner and dependencies before work starts.",
    };
  }
  const items = await allChanges();
  items.unshift(proposal);
  await saveChanges(items);
  return proposal;
}

export async function decideChange(id: string, status: Exclude<ChangeStatus, "Pending">, executionRunning: boolean) {
  const config = await getProjectConfig();
  if (!config) throw new Error("No target repository selected.");
  const items = await allChanges();
  const item = items.find(change => change.id === id && change.repoPath === config.repoPath);
  if (!item || item.status !== "Pending") throw new Error("Pending proposal not found.");
  if (status === "Approved") {
    if (executionRunning) throw new Error("Wait for the active Codex run before applying project changes.");
    const state = await readProjectFile("PROJECT_STATE.md", config.repoPath) || "# Project State\n";
    const decisions = await readProjectFile("DECISIONS.md", config.repoPath) || "# Decisions\n";
    const note = `- ${item.title} (approved for a later milestone; current milestone unchanged; proposal ${item.id})`;
    const stateAlreadyWritten = state.includes(item.id);
    const nextState = stateAlreadyWritten ? state : /## Approved later changes/i.test(state)
      ? state.replace(/(## Approved later changes[^\n]*\r?\n)/i, `$1${note}\n`)
      : `${state.trimEnd()}\n\n## Approved later changes\n${note}\n`;
    const nextDecisions = decisions.includes(`## Change ${item.id.slice(0, 8)} —`) ? decisions
      : `${decisions.trimEnd()}\n\n## Change ${item.id.slice(0, 8)} — ${item.title}\nStatus: Approved\nRequested during: ${item.currentMilestone}\nApplied to: Later milestone, to be selected during planning\nCurrent milestone interrupted: No\nReason: User explicitly approved this proposed direction; value and effort remain to be validated.\n`;
    if (nextState !== state) await writeProjectFile("PROJECT_STATE.md", nextState, config.repoPath);
    try { if (nextDecisions !== decisions) await writeProjectFile("DECISIONS.md", nextDecisions, config.repoPath); }
    catch (error) { if (!stateAlreadyWritten) await writeProjectFile("PROJECT_STATE.md", state, config.repoPath).catch(() => {}); throw error; }
  }
  item.status = status;
  await saveChanges(items);
  return item;
}
