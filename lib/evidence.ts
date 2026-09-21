import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { getProjectConfig } from "@/lib/project";

export type EvidenceMeta = {
  id: string;
  image: string;
  metaFile: string;
  createdAt: string;
  url: string;
  viewport: { width: number; height: number };
  title?: string;
  consoleErrors: string[];
  failedRequests: string[];
};

function safeName(value: string) {
  return value.replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 80);
}

export async function captureEvidence(input: { url: string; width?: number; height?: number; title?: string }) {
  const config = await getProjectConfig();
  if (!config) throw new Error("No project selected.");
  const parsed = new URL(input.url);
  if (!["http:","https:"].includes(parsed.protocol)) throw new Error("Only http/https URLs are allowed.");

  const width = Math.min(Math.max(input.width || 1440, 320), 2560);
  const height = Math.min(Math.max(input.height || 900, 480), 1800);
  const dir = path.join(config.repoPath, ".architect", "evidence");
  await fs.mkdir(dir, { recursive: true });

  const id = `${new Date().toISOString().replace(/[:.]/g,"-")}-${width}x${height}`;
  const image = `${id}.png`;
  const metaFile = `${id}.json`;
  const consoleErrors: string[] = [];
  const failedRequests: string[] = [];

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width, height } });
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text().slice(0, 500));
    });
    page.on("requestfailed", (req) => {
      failedRequests.push(`${req.method()} ${req.url()} — ${req.failure()?.errorText || "failed"}`.slice(0, 700));
    });
    await page.goto(parsed.toString(), { waitUntil: "networkidle", timeout: 30000 });
    await page.screenshot({ path: path.join(dir, image), fullPage: true });

    const meta: EvidenceMeta = {
      id,
      image,
      metaFile,
      createdAt: new Date().toISOString(),
      url: parsed.toString(),
      viewport: { width, height },
      title: input.title,
      consoleErrors,
      failedRequests,
    };
    await fs.writeFile(path.join(dir, metaFile), JSON.stringify(meta, null, 2), "utf8");
    return meta;
  } finally {
    await browser.close();
  }
}

export async function listEvidence(): Promise<EvidenceMeta[]> {
  const config = await getProjectConfig();
  if (!config) return [];
  const dir = path.join(config.repoPath, ".architect", "evidence");
  try {
    const files = (await fs.readdir(dir)).filter((f) => f.endsWith(".json"));
    const items: EvidenceMeta[] = [];
    for (const file of files) {
      try {
        items.push(JSON.parse(await fs.readFile(path.join(dir,file), "utf8")));
      } catch {}
    }
    return items.sort((a,b) => b.createdAt.localeCompare(a.createdAt));
  } catch {
    return [];
  }
}

export async function readEvidenceImage(file: string) {
  const config = await getProjectConfig();
  if (!config) throw new Error("No project selected.");
  if (!/^[A-Za-z0-9._-]+\.png$/.test(file)) throw new Error("Invalid evidence filename.");
  return fs.readFile(path.join(config.repoPath, ".architect", "evidence", file));
}
