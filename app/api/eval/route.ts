import { searchManual, type RetrievalMode } from "@/lib/retrieval";
import { GOLD } from "@/lib/eval-gold";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Retrieval evaluation: GET /api/eval?k=1,3,8&mode=hybrid|vector|keyword → hit@k and MRR over the gold set. */
export async function GET(req: Request) {
  const ks = (new URL(req.url).searchParams.get("k") ?? "3,6,10").split(",").map(Number).filter((n) => n > 0 && n <= 20);
  const K = Math.max(...ks);
  const m = new URL(req.url).searchParams.get("mode");
  const mode: RetrievalMode = m === "vector" || m === "keyword" ? m : "hybrid";
  const rows = await Promise.all(
    GOLD.map(async (g) => {
      const res = await searchManual(g.q, K, mode);
      const rank = res.findIndex((r) => r.pageStart <= g.pages[1] && r.pageEnd >= g.pages[0]) + 1;
      return { q: g.q, expected: `p.${g.pages[0]}–${g.pages[1]}`, rank: rank || null, top: res.slice(0, 3).map((r) => `#${r.id} p.${r.pageStart} ${r.similarity.toFixed(2)}`) };
    }),
  );
  const hit = Object.fromEntries(ks.map((k) => [`hit@${k}`, `${rows.filter((r) => r.rank && r.rank <= k).length}/${rows.length}`]));
  const mrr = rows.reduce((a, r) => a + (r.rank ? 1 / r.rank : 0), 0) / rows.length;
  return Response.json({ mode, ...hit, [`MRR@${K}`]: Number(mrr.toFixed(3)), rows });
}
