import { NextResponse } from "next/server";
import { authenticate, poll, report } from "@/lib/team-live";
export const runtime="nodejs";
export async function POST(request:Request) {
  try {
    if(Number(request.headers.get("content-length")||0)>16384) return NextResponse.json({error:"Payload too large."},{status:413});
    const id=await authenticate(request.headers.get("x-architect-worker"),request.headers.get("authorization"));
    if(!id) return NextResponse.json({error:"Unauthorized."},{status:401});
    const body=await request.json();
    const result=body.action==="poll"?await poll(id,body.data):body.action==="report"?await report(id,body.data):null;
    if(!result) throw new Error("Unsupported worker action.");
    return NextResponse.json(result);
  } catch(error) { return NextResponse.json({error:error instanceof Error?error.message:"Worker request failed."},{status:400}); }
}
