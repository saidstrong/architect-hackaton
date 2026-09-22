import { NextResponse } from "next/server";
import { createTeamTask, getTeamSnapshot, markTeamTaskIntegrated, recordTeamResult, setTeamTaskStatus, updateTeamTask, updateWorker } from "@/lib/team";

export const runtime = "nodejs";
export async function GET() {
  try { return NextResponse.json({ team:await getTeamSnapshot() }); }
  catch (error) { return NextResponse.json({ error:error instanceof Error ? error.message : "Unable to read team state." }, { status:400 }); }
}
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const team = body.action === "worker" ? await updateWorker(body.data)
      : body.action === "createTask" ? await createTeamTask(body.data)
      : body.action === "updateTask" ? await updateTeamTask(body.data)
      : body.action === "status" ? await setTeamTaskStatus(body.data)
      : body.action === "result" ? await recordTeamResult(body.data)
      : body.action === "integrated" ? await markTeamTaskIntegrated(body.data)
      : null;
    if (!team) throw new Error("Unsupported team action.");
    return NextResponse.json({ team });
  } catch (error) {
    return NextResponse.json({ error:error instanceof Error ? error.message : "Unable to update team state." }, { status:400 });
  }
}
