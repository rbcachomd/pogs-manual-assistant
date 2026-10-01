import "server-only";
import { embed } from "ai";
import { openai } from "@ai-sdk/openai";
import chunks from "@/corpus/chunks.json";
import { RAG } from "./config";
import { ensureSeeded, sql } from "./seed";
import { bm25Search } from "./bm25";

export type RetrievedChunk = {
  id: number;
  section: string;
  pageStart: number;
  pageEnd: number;
  content: string;
  similarity: number;
};
export type RetrievalMode = "hybrid" | "vector" | "keyword";

type CorpusChunk = { id: number; section: string; pageStart: number; pageEnd: number; content: string };
const BY_ID = new Map((chunks as CorpusChunk[]).map((c) => [c.id, c]));
const RRF_K = 60;
const CANDIDATES = 30;

/**
 * Hybrid retrieval = semantic (pgvector cosine, Neon) + keyword (in-memory BM25),
 * merged with Reciprocal Rank Fusion. Vectors handle paraphrase and Taglish; BM25
 * rescues decisive terms buried in long passages (e.g. "airfare" inside the list
 * of the President's duties).
 */
export async function searchManual(
  query: string,
  topK = RAG.topK,
  mode: RetrievalMode = (process.env.RAG_MODE as RetrievalMode) || "hybrid",
  kwWeight = RAG.kwWeight,
): Promise<RetrievedChunk[]> {
  const sims = new Map<number, number>();
  const score = new Map<number, number>();
  const add = (id: number, rank: number, w = 1) => score.set(id, (score.get(id) ?? 0) + w / (RRF_K + rank));

  if (mode !== "keyword") {
    const [{ embedding }] = await Promise.all([
      embed({ model: openai.textEmbeddingModel(RAG.embeddingModel), value: query }),
      ensureSeeded(),
    ]);
    const rows = (await sql().query(
      `SELECT id, 1 - (embedding <=> $1::vector) AS similarity
         FROM manual_chunks ORDER BY embedding <=> $1::vector LIMIT $2`,
      [`[${embedding.join(",")}]`, CANDIDATES],
    )) as Array<{ id: number; similarity: number }>;
    rows.forEach((r, i) => {
      sims.set(Number(r.id), Number(r.similarity));
      if (Number(r.similarity) >= RAG.minSimilarity) add(Number(r.id), i + 1);
    });
  }
  if (mode !== "vector") {
    bm25Search(query, CANDIDATES).forEach((r, i) => add(r.id, i + 1, mode === "keyword" ? 1 : kwWeight));
  }

  return [...score.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topK)
    .map(([id]) => {
      const c = BY_ID.get(id)!;
      return { ...c, similarity: sims.get(id) ?? 0 };
    });
}
