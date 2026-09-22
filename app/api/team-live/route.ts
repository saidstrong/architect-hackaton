import { NextResponse } from "next/server";
import { dispatchTask, generateToken, liveSnapshot, setStopAfterTask, useManual } from "@/lib/team-live";
export const runtime="nodejs";
export async function GET() { try { return NextResponse.json(await liveSnapshot()); } catch(error) { return NextResponse.json({error:error instanceof Error?error.message:"Live state failed."},{status:400}); } }
export async function POST(request:Request) { try { const body=await request.json(); const result=body.action==="generate"?await generateToken(body.data):body.action==="dispatch"?await dispatchTask(body.data):body.action==="stopAfterTask"?await setStopAfterTask(body.data):body.action==="manual"?await useManual(body.data):null; if(!result) throw new Error("Unsupported action."); return NextResponse.json(result); } catch(error) { return NextResponse.json({error:error instanceof Error?error.message:"Live action failed."},{status:400}); } }
