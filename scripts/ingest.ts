/**
 * Ingest the POGS Administrative Manual into Neon Postgres (pgvector).
 *
 *   npm run ingest            # parse, chunk, embed, (re)load the table
 *   npm run ingest -- --dry   # parse + chunk only; writes corpus/chunks.preview.json
 *
 * Expects the PDF at corpus/pogs-administrative-manual.pdf.
 */
import "dotenv/config";
import { config as loadEnv } from "dotenv";
import { readFileSync, writeFileSync, copyFileSync, mkdirSync } from "node:fs";
import { extractText, getDocumentProxy } from "unpdf";
import { embedMany } from "ai";
import { openai } from "@ai-sdk/openai";
import { neon } from "@neondatabase/serverless";

loadEnv({ path: ".env.local" });

const PDF = "corpus/pogs-administrative-manual.pdf";
const EMBED_MODEL = process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small";
const TARGET = 1400; // characters (~350 tokens): small enough for precise citations
const MAX = 2200;
const OVERLAP = 200;
const DRY = process.argv.includes("--dry");

type Chunk = { section: string; pageStart: number; pageEnd: number; content: string };

// Heading patterns observed in the POGS Administrative Manual 2026:
//   CHAPTER 3            (next line = chapter title, e.g. "COMMITTEES")
//   II. STANDING COMMITTEES            (Roman-numeral section, ALL CAPS)
//   C. COMMITTEE ON COMMUNITY SERVICE  (lettered sub-heading, ALL CAPS)
const CAPS = "[A-Z0-9][A-Z0-9 ,&'\u2019()\\-\u2013/.]+";
const CHAPTER = /^CHAPTER\s+(\d+)\s*$/;
const SECTION = new RegExp(`^[IVXLC]+\\.\\s+${CAPS}$`);
const SUBSECTION = new RegExp(`^[A-Z]\\.\\s+${CAPS}$`);
const ROMAN = ["I","II","III","IV","V","VI","VII","VIII","IX","X","XI","XII","XIII","XIV","XV","XVI","XVII","XVIII","XIX","XX"];
const MIN_FLUSH = 300; // merge very short sections into the next chunk

function clean(s: string) {
  return s.replace(/\u00ad/g, "").replace(/[ \t]+/g, " ").trim();
}

function chunkPages(pages: string[]): Chunk[] {
  const chunks: Chunk[] = [];
  let chapter = "Front matter";
  let section = "";
  let sub = "";
  let awaitingTitle = false;
  let buf = "";
  let bufLabel = "";
  let start = 1;
  let end = 1;

  let lastRoman = 0;
  let lastLetter = "";
  // Single letters I, V, X, L, C are ambiguous (Roman numeral vs. letter): resolve by sequence.
  const headingKind = (line: string): "section" | "sub" | null => {
    const isSec = SECTION.test(line);
    const isSub = SUBSECTION.test(line);
    if (!isSec && !isSub) return null;
    if (isSec && !isSub) return "section";
    if (isSub && !isSec) return "sub";
    const tag = line[0];
    const nextLetter = lastLetter ? String.fromCharCode(lastLetter.charCodeAt(0) + 1) : "A";
    if (tag === nextLetter) return "sub";
    if (tag === ROMAN[lastRoman] || tag === "I") return "section";
    return "sub";
  };
  const label = () => [chapter, section, sub].filter(Boolean).join(" › ");
  const flush = (keepOverlap: boolean) => {
    const content = buf.trim();
    if (content.length > 60) chunks.push({ section: bufLabel || label(), pageStart: start, pageEnd: end, content });
    buf = keepOverlap ? content.slice(-OVERLAP).replace(/^\S*\s/, "… ") : "";
    bufLabel = keepOverlap ? label() : "";
  };
  const add = (line: string, page: number) => {
    if (buf === "") { start = page; bufLabel = label(); }
    buf += (buf ? "\n" : "") + line;
    end = page;
  };

  pages.forEach((pageText, i) => {
    const page = i + 1;
    for (const raw of pageText.split("\n")) {
      const line = clean(raw);
      if (!line || /^\d{1,3}$/.test(line)) continue;
      if (/^PHILIPPINE OBSTETRICAL AND GYNECOLOGICAL SOCIETY|^\(FOUNDATION\), INC\.$|^ADMINISTRATIVE MANUAL 2026$/.test(line)) continue;

      if (awaitingTitle) {
        chapter = `${chapter} – ${line}`;
        awaitingTitle = false;
        bufLabel = label();
        add(line, page);
        continue;
      }
      const ch = line.match(CHAPTER);
      if (ch) {
        flush(false);
        chapter = `Chapter ${ch[1]}`;
        section = sub = "";
        lastRoman = 0;
        lastLetter = "";
        awaitingTitle = true;
        add(line, page);
        continue;
      }
      const kind = headingKind(line);
      if (kind) {
        if (buf.length >= MIN_FLUSH) flush(false);
        const tag = line.split(".")[0];
        const short = line.length > 70 ? line.slice(0, 67) + "…" : line;
        if (kind === "section") { section = short; sub = ""; lastRoman = ROMAN.indexOf(tag) + 1; lastLetter = ""; }
        else { sub = short; lastLetter = tag; }
        if (buf === "" || buf.length < MIN_FLUSH) bufLabel = label();
        add(line, page);
        continue;
      }
      add(line, page);
      if (buf.length >= TARGET && /[.:;]$/.test(line)) flush(true);
      else if (buf.length >= MAX) flush(true);
    }
  });
  flush(false);
  return chunks;
}

async function main() {
  const data = new Uint8Array(readFileSync(PDF));
  const pdf = await getDocumentProxy(data);
  const { text, totalPages } = await extractText(pdf, { mergePages: false });
  const chunks = chunkPages(text as string[]);
  console.log(`Parsed ${totalPages} pages → ${chunks.length} chunks`);

  // Publish the source so citations can deep-link to the page.
  mkdirSync("public/docs", { recursive: true });
  copyFileSync(PDF, "public/docs/pogs-administrative-manual.pdf");

  writeFileSync("corpus/chunks.preview.json", JSON.stringify(chunks, null, 2));
  if (DRY) {
    const lens = chunks.map((c) => c.content.length);
    console.log(`Dry run. avg ${Math.round(lens.reduce((a, b) => a + b, 0) / lens.length)} chars, max ${Math.max(...lens)}`);
    return;
  }

  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL missing in .env.local");
  const sql = neon(process.env.DATABASE_URL);
  await sql`CREATE EXTENSION IF NOT EXISTS vector`;
  await sql`DROP TABLE IF EXISTS manual_chunks`;
  await sql`CREATE TABLE manual_chunks (
    id SERIAL PRIMARY KEY,
    section TEXT NOT NULL,
    page_start INT NOT NULL,
    page_end INT NOT NULL,
    content TEXT NOT NULL,
    embedding vector(1536) NOT NULL
  )`;

  const BATCH = 64;
  for (let i = 0; i < chunks.length; i += BATCH) {
    const batch = chunks.slice(i, i + BATCH);
    // Prepend the heading so the vector carries its structural context.
    const { embeddings } = await embedMany({
      model: openai.textEmbeddingModel(EMBED_MODEL),
      values: batch.map((c) => `${c.section}\n\n${c.content}`),
    });
    for (let j = 0; j < batch.length; j++) {
      const c = batch[j];
      await sql.query(
        `INSERT INTO manual_chunks (section, page_start, page_end, content, embedding) VALUES ($1,$2,$3,$4,$5::vector)`,
        [c.section, c.pageStart, c.pageEnd, c.content, `[${embeddings[j].join(",")}]`],
      );
    }
    console.log(`Embedded ${Math.min(i + BATCH, chunks.length)}/${chunks.length}`);
  }
  await sql`CREATE INDEX ON manual_chunks USING hnsw (embedding vector_cosine_ops)`;
  console.log("Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
