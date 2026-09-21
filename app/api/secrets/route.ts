import { NextResponse } from "next/server";
import { setSecret } from "@/lib/secrets";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const { name, value } = await request.json();
    if (typeof name !== "string" || typeof value !== "string") throw new Error("Invalid secret.");
    const result = await setSecret(name, value);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to save secret." }, { status: 400 });
  }
}
