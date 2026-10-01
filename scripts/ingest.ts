/**
 * Parse and chunk the POGS Administrative Manual.
 *
 *   npm run ingest
 *
 * Reads corpus/pogs-administrative-manual.pdf and writes corpus/chunks.json
 * (id, section path, page range, text). Embedding and loading into Neon happen
 * server-side on first use, see lib/seed.ts.
 */
import { readFileSync, writeFileSync, copyFileSync, mkdirSync } from "node:fs";
import { extractText, getDocumentProxy } from "unpdf";

const PDF = "corpus/pogs-administrative-manual.pdf";
const TARGET = 1400; // characters (~350 tokens): small enough for precise citations
const MAX = 2200;
const OVERLAP = 200;

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
    start = end; // overlap text comes from the last page of the previous chunk
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
  const chunks = chunkPages(text as string[]).map((c, i) => ({ id: i + 1, ...c }));
  const lens = chunks.map((c) => c.content.length);
  console.log(`Parsed ${totalPages} pages → ${chunks.length} chunks (avg ${Math.round(lens.reduce((a, b) => a + b, 0) / lens.length)} chars, max ${Math.max(...lens)})`);

  // Publish the source so citations can deep-link to the page.
  mkdirSync("public/docs", { recursive: true });
  copyFileSync(PDF, "public/docs/pogs-administrative-manual.pdf");

  // The app embeds and loads these into Neon on first use (lib/seed.ts).
  writeFileSync("corpus/chunks.json", JSON.stringify(chunks, null, 1));
  console.log("Wrote corpus/chunks.json");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
