import fs from "node:fs/promises";
import path from "node:path";
import { getProjectConfig } from "@/lib/project";

const KEY_RE = /^[A-Z][A-Z0-9_]*$/;

export async function setSecret(name: string, value: string) {
  if (!KEY_RE.test(name)) throw new Error("Invalid environment variable name.");
  if (!value.trim()) throw new Error("Secret value cannot be empty.");
  const config = await getProjectConfig();
  if (!config) throw new Error("No project selected.");

  const envPath = path.join(config.repoPath, ".env.local");
  let current = "";
  try { current = await fs.readFile(envPath, "utf8"); } catch {}

  const lines = current.split(/\r?\n/).filter(Boolean);
  const filtered = lines.filter((line) => !line.startsWith(name + "="));
  filtered.push(`${name}=${value.replace(/\r?\n/g, "")}`);
  await fs.writeFile(envPath, filtered.join("\n") + "\n", { encoding: "utf8", mode: 0o600 });

  const ignorePath = path.join(config.repoPath, ".gitignore");
  let ignore = "";
  try { ignore = await fs.readFile(ignorePath, "utf8"); } catch {}
  if (!ignore.split(/\r?\n/).includes(".env.local")) {
    await fs.writeFile(ignorePath, ignore.replace(/\s*$/, "") + "\n.env.local\n", "utf8");
  }

  return { name, saved: true };
}
