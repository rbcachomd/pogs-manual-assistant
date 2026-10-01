/**
 * Minimal in-memory BM25 over the 234 manual chunks (keyword half of hybrid retrieval).
 * Rare, decisive terms ("airfare", "dormitory", "COMELEC") outweigh common ones ("POGS", "member").
 */
import chunks from "@/corpus/chunks.json";

type Doc = { id: number; section: string; content: string };

const STOP = new Set(
  (
    "a an and are as at be been being but by can could did do does for from had has have how i if in into is it its may might " +
    "must no not of on or our shall should so than that the their them then there these they this those to under upon was " +
    "we were what when where which who whom whose why will with would you your about any all also each other such only own " +
    // Filipino / Taglish function words
    "ang ng nang sa mga na ba bang pa po ho din rin lang naman ako ko mo siya sila kami tayo kayo ito iyan iyon yung yun " +
    "pwede puwede paano saan kailan sino ano anong ilang magkano kung para may mayroon wala hindi at o"
  ).split(/\s+/),
);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP.has(w))
    .map(stem);
}

function stem(w: string): string {
  if (w.length > 5 && w.endsWith("ies")) return w.slice(0, -3) + "y";
  if (w.length > 6 && w.endsWith("ing")) return w.slice(0, -3);
  if (w.length > 5 && w.endsWith("ed")) return w.slice(0, -2);
  if (w.length > 4 && w.endsWith("es") && !w.endsWith("ses")) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
  return w;
}

const K1 = 1.2;
const B = 0.75;
const docs = (chunks as Doc[]).map((c) => {
  const toks = tokenize(`${c.section} ${c.content}`);
  const tf = new Map<string, number>();
  for (const t of toks) tf.set(t, (tf.get(t) ?? 0) + 1);
  return { id: c.id, len: toks.length, tf };
});
const avgLen = docs.reduce((a, d) => a + d.len, 0) / docs.length;
const df = new Map<string, number>();
for (const d of docs) for (const t of d.tf.keys()) df.set(t, (df.get(t) ?? 0) + 1);
const idf = (t: string) => {
  const n = df.get(t) ?? 0;
  return Math.log(1 + (docs.length - n + 0.5) / (n + 0.5));
};

/** Returns chunk ids ranked by BM25 score (best first). */
export function bm25Search(query: string, limit = 30): { id: number; score: number }[] {
  const terms = [...new Set(tokenize(query))];
  if (terms.length === 0) return [];
  const scored = docs.map((d) => {
    let s = 0;
    for (const t of terms) {
      const f = d.tf.get(t);
      if (!f) continue;
      s += idf(t) * ((f * (K1 + 1)) / (f + K1 * (1 - B + (B * d.len) / avgLen)));
    }
    return { id: d.id, score: s };
  });
  return scored.filter((x) => x.score > 0).sort((a, b) => b.score - a.score).slice(0, limit);
}
