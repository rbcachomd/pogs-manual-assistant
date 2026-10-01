import "server-only";
import { embed } from "ai";
import { openai } from "@ai-sdk/openai";
import { RAG } from "./config";
import { ensureSeeded, sql } from "./seed";

export type RetrievedChunk = {
  id: number;
  section: string;
  pageStart: number;
  pageEnd: number;
  content: string;
  similarity: number;
};

/** Embed the query and return the topK most similar manual chunks. */
export async function searchManual(query: string, topK = RAG.topK): Promise<RetrievedChunk[]> {
  const [{ embedding }] = await Promise.all([
    embed({ model: openai.textEmbeddingModel(RAG.embeddingModel), value: query }),
    ensureSeeded(),
  ]);
  const rows = (await sql().query(
    `SELECT id, section, page_start, page_end, content,
            1 - (embedding <=> $1::vector) AS similarity
       FROM manual_chunks
      ORDER BY embedding <=> $1::vector
      LIMIT $2`,
    [`[${embedding.join(",")}]`, topK],
  )) as Array<Record<string, unknown>>;

  return rows
    .map((r) => ({
      id: Number(r.id),
      section: String(r.section),
      pageStart: Number(r.page_start),
      pageEnd: Number(r.page_end),
      content: String(r.content),
      similarity: Number(r.similarity),
    }))
    .filter((r) => r.similarity >= RAG.minSimilarity);
}
