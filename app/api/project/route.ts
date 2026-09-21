import { NextResponse } from "next/server";
import { getProjectConfig, saveProjectConfig } from "@/lib/project";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ config: await getProjectConfig() });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    return NextResponse.json({ config: await saveProjectConfig(body) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to select project." }, { status: 400 });
  }
}
