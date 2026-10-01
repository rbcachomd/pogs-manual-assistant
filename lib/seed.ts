import "server-only";
import { createHash } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import { embedMany } from "ai";
import { openai } from "@ai-sdk/openai";
import chunks from "@/corpus/chunks.json";
import { RAG } from "./config";

type CorpusChunk = { id: number; section: string; pageStart: number; pageEnd: number; content: string };
const CORPUS = chunks as CorpusChunk[];

// Any change to the chunk file or embedding model triggers an automatic re-index.
export const CORPUS_VERSION = createHash("sha256")
  .update(RAG.embeddingModel)
  .update(JSON.stringify(CORPUS))
  .digest("hex")
  .slice(0, 16);

export function sql() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  return neon(url);
}

let ready: Promise<SeedStatus> | null = null;

export type SeedStatus = { status: "ready" | "seeded"; chunks: number; version: string; ms?: number };

/**
 * Idempotent: makes sure Neon holds the current corpus version.
 * The first request after a deploy (or a corpus change) embeds and loads all chunks;
 * every later call costs one cheap metadata lookup per server instance.
 */
export function ensureSeeded(): Promise<SeedStatus> {
  if (!ready) {
    ready = seed().catch((e) => {
      ready = null; // allow retry on the next request
      throw e;
    });
  }
  return ready;
}

async function seed(): Promise<SeedStatus> {
  const db = sql();
  await db`CREATE EXTENSION IF NOT EXISTS vector`;
  await db`CREATE TABLE IF NOT EXISTS rag_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TIMESTAMPTZ DEFAULT now())`;

  const current = (await db`SELECT value FROM rag_meta WHERE key = 'corpus_version'`) as { value: string }[];
  if (current[0]?.value === CORPUS_VERSION) {
    return { status: "ready", chunks: CORPUS.length, version: CORPUS_VERSION };
  }

  // Simple lock so two cold instances don't index at the same time (stale after 5 minutes).
  const lock = (await db`
    INSERT INTO rag_meta (key, value) VALUES ('seed_lock', ${CORPUS_VERSION})
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
      WHERE rag_meta.updated_at < now() - interval '5 minutes'
    RETURNING key`) as unknown[];
  if (lock.length === 0) {
    throw new Error("The manual index is being prepared. Please try again in about a minute.");
  }

  const t0 = Date.now();
  try {
    await db`DROP TABLE IF EXISTS manual_chunks`;
    await db`CREATE TABLE manual_chunks (
      id INT PRIMARY KEY,
      section TEXT NOT NULL,
      page_start INT NOT NULL,
      page_end INT NOT NULL,
      content TEXT NOT NULL,
      embedding vector(1536) NOT NULL
    )`;

    const BATCH = 60;
    for (let i = 0; i < CORPUS.length; i += BATCH) {
      const batch = CORPUS.slice(i, i + BATCH);
      // Prepend the section path so each vector carries its structural context.
      const { embeddings } = await embedMany({
        model: openai.textEmbeddingModel(RAG.embeddingModel),
        values: batch.map((c) => `${c.section}\n\n${c.content}`),
        maxParallelCalls: 2,
      });
      const params: unknown[] = [];
      const rows = batch.map((c, j) => {
        const b = j * 6;
        params.push(c.id, c.section, c.pageStart, c.pageEnd, c.content, `[${embeddings[j].join(",")}]`);
        return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}::vector)`;
      });
      await db.query(
        `INSERT INTO manual_chunks (id, section, page_start, page_end, content, embedding) VALUES ${rows.join(",")}`,
        params,
      );
    }
    await db`CREATE INDEX manual_chunks_embedding_idx ON manual_chunks USING hnsw (embedding vector_cosine_ops)`;
    await db`
      INSERT INTO rag_meta (key, value) VALUES ('corpus_version', ${CORPUS_VERSION})
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`;
  } finally {
    await db`DELETE FROM rag_meta WHERE key = 'seed_lock'`;
  }
  return { status: "seeded", chunks: CORPUS.length, version: CORPUS_VERSION, ms: Date.now() - t0 };
}
