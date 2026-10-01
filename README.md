# POGS Administrative Manual Assistant

A public, citation-first RAG chatbot over the **POGS Administrative Manual 2026** (Philippine Obstetrical and Gynecological Society (Foundation), Inc.). It answers questions on membership, governance, committees, PBOG, CREED, chapters, meetings, finance, protocol, and facilities **only from the manual**, citing the chapter, section, and page of each statement. Each citation links to that page of the source PDF.

Graded Mini Project 14.3, *Ship Your Own RAG* (AIM).

**Developed by Richard Ronald B. Cacho, MD, MHA, Public Relations Officer (2026).**

## Architecture

| Layer | Choice |
|---|---|
| Framework | Next.js 15 (App Router), deployed on Vercel |
| LLM orchestration | Vercel AI SDK 5: `streamText` with a `searchManual` **tool call**, multi-step (`stopWhen: stepCountIs(5)`) |
| Models | OpenAI `gpt-4.1-mini` (chat, temperature 0.1); `text-embedding-3-small` (1536-d) |
| Retrieval | **Hybrid**: Neon Postgres + pgvector (HNSW, cosine) **plus** in-memory BM25, fused with weighted Reciprocal Rank Fusion (keyword weight 0.25), top-K = 8 |
| Corpus | 135-page PDF → 234 structure-aware chunks (`corpus/chunks.json`) |
| Indexing | Self-seeding: on first request the server embeds the chunks and loads Neon; a content hash in `rag_meta` triggers re-indexing only when the corpus changes |

**Request flow:** browser → `/api/chat` (server) → model decides to call `searchManual` → vector search (Neon) + BM25 keyword search → weighted RRF fusion → passages (with marker, section path, pages) returned to the model → grounded answer streamed back with `[#id]` markers → UI renders them as numbered citations and a Sources panel.

## Key design decisions

- **Structure-aware chunking.** The manual follows `CHAPTER n` → `I.` Roman sections → `A.` lettered committees. The ingester follows that hierarchy. It flushes at headings, merges fragments shorter than 300 characters, and targets about 1,400 characters per chunk with a 200-character overlap. Single letters (I, V, X, L, C) can be either Roman numerals or list letters; the ingester resolves this from sequence.
- **Contextual embeddings.** Each chunk is embedded as `section path + text`. This lets a query such as "COMELEC duties" match a passage whose body never repeats the committee name.
- **Citations are metadata, not model output.** The model only emits passage markers. Section titles and page numbers come from the database, so they cannot be hallucinated.
- **Refusal over guessing.** The system prompt and tool description require a search before answering, and an explicit decline when the passages do not cover the question.

## Evaluation (live, 20 gold questions with page-level answers)

| Retrieval mode | hit@1 | hit@3 | hit@8 | MRR@8 |
|---|---|---|---|---|
| Vector only | 18/20 | 19/20 | 20/20 | 0.935 |
| Keyword only (BM25) | 14/20 | 17/20 | 19/20 | 0.781 |
| Hybrid, equal weights | 17/20 | 20/20 | 20/20 | 0.917 |
| **Hybrid, keyword weight 0.25 (shipped)** | **18/20** | **20/20** | **20/20** | **0.950** |

Reproduce: `GET /api/eval?k=1,3,8&mode=vector|keyword|hybrid&w=0.25`. With only 20 questions this is a small benchmark; the weight was chosen on the same set, so treat it as tuning evidence, not a held-out result.

## Requirements checklist

- Public on Vercel ✔ · Streaming ✔ · Retrieval as a tool call ✔ · Sources shown ✔ · Meaningful empty state ✔ · Real corpus ✔
- **No client-side secrets:** `OPENAI_API_KEY` and `DATABASE_URL` are read only in `app/api/chat` and `lib/retrieval.ts` (guarded by `server-only`). Neither variable has the `NEXT_PUBLIC_` prefix.

## Stretch goals

1. **Source-PDF deep links from citations:** every source opens `/docs/pogs-administrative-manual.pdf#page=N`.
2. **Hybrid retrieval:** pgvector + BM25 with weighted RRF. This fixed a real failure: the President's airfare subsidy is buried in a long list of duties, ranked 8th by vectors alone, and the bot refused to answer.

The empty state also includes six suggested-question chips, and a retrieval evaluation endpoint (`/api/eval`) supports tuning.

## Run locally

```bash
npm install
cp .env.example .env.local      # add OPENAI_API_KEY and DATABASE_URL
npm run ingest                  # parse + chunk the PDF -> corpus/chunks.json
npm run dev                     # first request embeds and loads Neon automatically
# GET /api/health  -> readiness (builds the index on first call)
# GET /api/eval?k=3,6,10 -> retrieval hit@K and MRR on 20 gold questions
```

## Deploy

Import the repo in Vercel and set `OPENAI_API_KEY` and `DATABASE_URL` for **Production** and **Preview**. Deploy, then open `/api/health` once to build the index (about 30 seconds). Verify in an incognito window.

## Disclaimer

This is a reference aid only. The official, Board-approved text of the POGS Administrative Manual prevails.
