import { NextResponse } from "next/server";
import { getHackathonTimer, startHackathonTimer } from "@/lib/hackathon-timer";

export const runtime = "nodejs";
export async function GET() {
  return NextResponse.json({ timer: await getHackathonTimer() });
}
export async function POST(request: Request) {
  try {
    const body = await request.json();
    return NextResponse.json({ timer: await startHackathonTimer(body.durationHours) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to start timer." }, { status: 400 });
  }
}
