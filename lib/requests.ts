import fs from "node:fs/promises";
import path from "node:path";
import { getProjectConfig } from "@/lib/project";

export type ArchitectRequest = {
  file: string;
  type: "secret" | "approval" | string;
  name?: string;
  reason?: string;
  required?: boolean;
  [key: string]: unknown;
};

export async function getRequests(): Promise<ArchitectRequest[]> {
  const config = await getProjectConfig();
  if (!config) return [];
  const dir = path.join(config.repoPath, ".architect", "requests");
  try {
    const files = (await fs.readdir(dir)).filter((f) => f.endsWith(".json"));
    const output: ArchitectRequest[] = [];
    for (const file of files) {
      try {
        const data = JSON.parse(await fs.readFile(path.join(dir,file), "utf8"));
        output.push({ file, ...data });
      } catch {}
    }
    return output;
  } catch {
    return [];
  }
}

export async function resolveRequest(file: string) {
  const config = await getProjectConfig();
  if (!config) throw new Error("No project selected.");
  if (!/^[A-Za-z0-9._-]+\.json$/.test(file)) throw new Error("Invalid request filename.");
  await fs.unlink(path.join(config.repoPath, ".architect", "requests", file)).catch(() => {});
}
