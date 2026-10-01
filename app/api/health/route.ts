import { ensureSeeded } from "@/lib/seed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Warm-up + readiness probe. The first call after a deploy builds the vector index. */
export async function GET() {
  const missing = ["OPENAI_API_KEY", "DATABASE_URL"].filter((k) => !process.env[k]);
  if (missing.length) {
    return Response.json({ ok: false, error: `Missing environment variables: ${missing.join(", ")}` }, { status: 500 });
  }
  try {
    const s = await ensureSeeded();
    return Response.json({ ok: true, ...s });
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 503 });
  }
}
