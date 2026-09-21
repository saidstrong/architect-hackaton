import { NextResponse } from "next/server";
import { createDryRunRepo } from "@/lib/dryrun";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const { repoPath } = await request.json();
    if (typeof repoPath !== "string" || !repoPath.trim()) throw new Error("Repository path is required.");
    return NextResponse.json({ result: await createDryRunRepo(repoPath.trim()) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to create dry run." }, { status: 400 });
  }
}
