import fs from "node:fs/promises";
import path from "node:path";
import { getProjectConfig } from "@/lib/project";

export type HackathonTimer = { repoPath: string; startedAt: string; endsAt: string; durationHours: number };
const timerPath = path.join(process.cwd(), ".architect-runtime", "timer.json");
async function readTimers(): Promise<HackathonTimer[]> {
  try {
    const value: unknown = JSON.parse(await fs.readFile(timerPath, "utf8"));
    return Array.isArray(value) ? value as HackathonTimer[] : value && typeof value === "object" ? [value as HackathonTimer] : [];
  } catch { return []; }
}

export async function getHackathonTimer(): Promise<HackathonTimer | null> {
  const config = await getProjectConfig();
  if (!config) return null;
  const timer = (await readTimers()).find(item => item.repoPath === config.repoPath);
  return timer && Number.isFinite(Date.parse(timer.startedAt)) && Number.isFinite(Date.parse(timer.endsAt)) ? timer : null;
}

export async function startHackathonTimer(durationHours: number): Promise<HackathonTimer> {
  const config = await getProjectConfig();
  if (!config) throw new Error("No target repository selected.");
  if (!Number.isInteger(durationHours) || durationHours < 1 || durationHours > 12) throw new Error("Duration must be 1–12 whole hours.");
  const existing = await getHackathonTimer();
  if (existing && Date.parse(existing.endsAt) > Date.now()) throw new Error("A timer is already running for this project.");
  const now = Date.now();
  const timer = { repoPath: config.repoPath, startedAt: new Date(now).toISOString(), endsAt: new Date(now + durationHours * 3_600_000).toISOString(), durationHours };
  const timers = (await readTimers()).filter(item => item.repoPath !== config.repoPath);
  timers.push(timer);
  await fs.mkdir(path.dirname(timerPath), { recursive: true });
  await fs.writeFile(timerPath, JSON.stringify(timers, null, 2), "utf8");
  return timer;
}
