# POGS Administrative Manual Assistant

A public, citation-first RAG chatbot over the **POGS Administrative Manual 2026** (Philippine Obstetrical and Gynecological Society (Foundation), Inc.). It answers questions on membership, governance, committees, PBOG, CREED, chapters, meetings, finance, protocol, and facilities **only from the manual**, citing the chapter, section, and page of each statement. Each citation links to that page of the source PDF.

Graded Mini Project 14.3, *Ship Your Own RAG* (AIM).

## Architecture

| Layer | Choice |
|---|---|
| Framework | Next.js 15 (App Router), deployed on Vercel |
| LLM orchestration | Vercel AI SDK 5: `streamText` with a `searchManual` **tool call**, multi-step (`stopWhen: stepCountIs(5)`) |
| Models | OpenAI `gpt-4.1-mini` (chat, temperature 0.1); `text-embedding-3-small` (1536-d) |
| Vector store | Neon Postgres + pgvector, HNSW cosine index |
| Corpus | 135-page PDF → 234 structure-aware chunks |

**Request flow:** browser → `/api/chat` (server) → model decides to call `searchManual` → query embedded → top-K cosine search in Neon → passages (with marker, section path, pages) returned to the model → grounded answer streamed back with `[#id]` markers → UI renders them as numbered citations and a Sources panel.

## Key design decisions

- **Structure-aware chunking.** The manual follows `CHAPTER n` → `I.` Roman sections → `A.` lettered committees. The ingester follows that hierarchy. It flushes at headings, merges fragments shorter than 300 characters, and targets about 1,400 characters per chunk with a 200-character overlap. Single letters (I, V, X, L, C) can be either Roman numerals or list letters; the ingester resolves this from sequence.
- **Contextual embeddings.** Each chunk is embedded as `section path + text`. This lets a query such as "COMELEC duties" match a passage whose body never repeats the committee name.
- **Citations are metadata, not model output.** The model only emits passage markers. Section titles and page numbers come from the database, so they cannot be hallucinated.
- **Refusal over guessing.** The system prompt and tool description require a search before answering, and an explicit decline when the passages do not cover the question.

## Requirements checklist

- Public on Vercel ✔ · Streaming ✔ · Retrieval as a tool call ✔ · Sources shown ✔ · Meaningful empty state ✔ · Real corpus ✔
- **No client-side secrets:** `OPENAI_API_KEY` and `DATABASE_URL` are read only in `app/api/chat` and `lib/retrieval.ts` (guarded by `server-only`). Neither variable has the `NEXT_PUBLIC_` prefix.

## Stretch goals

1. **Source-PDF deep links from citations:** every source opens `/docs/pogs-administrative-manual.pdf#page=N`.
2. **Suggested-prompt chips:** six curated questions across the manual's main domains.

## Run locally

```bash
npm install
cp .env.example .env.local      # add OPENAI_API_KEY and DATABASE_URL
npm run ingest -- --dry         # parse + chunk only (writes corpus/chunks.preview.json)
npm run ingest                  # embed + load Neon
npm run eval -- 3 6 10          # retrieval hit@K on 20 gold questions
npm run dev
```

## Deploy

Import the repo in Vercel, then set `OPENAI_API_KEY` and `DATABASE_URL` for **Production** and **Preview**. Deploy, and verify in an incognito window.

## Disclaimer

This is a reference aid only. The official, Board-approved text of the POGS Administrative Manual prevails.
