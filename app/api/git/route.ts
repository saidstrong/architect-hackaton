import { NextResponse } from "next/server";
import { getGitStatus } from "@/lib/git";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ git: await getGitStatus() });
}
