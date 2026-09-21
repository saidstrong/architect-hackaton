import { readEvidenceImage } from "@/lib/evidence";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const file = new URL(request.url).searchParams.get("file") || "";
    const bytes = await readEvidenceImage(file);
    return new Response(bytes, { headers: { "content-type": "image/png", "cache-control": "no-store" } });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
