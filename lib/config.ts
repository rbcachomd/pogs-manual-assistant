// Central, server-only configuration. Nothing here is ever sent to the browser.
export const CORPUS = {
  title: "POGS Administrative Manual",
  shortTitle: "Admin Manual",
  // Public path of the source PDF (placed in /public/docs) used for citation links.
  pdfPath: "/docs/pogs-administrative-manual.pdf",
};

export const RAG = {
  embeddingModel: process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small",
  embeddingDims: 1536,
  chatModel: process.env.OPENAI_CHAT_MODEL ?? "gpt-4.1-mini",
  topK: Number(process.env.RAG_TOP_K ?? 6),
  // Chunks below this cosine similarity are discarded as noise.
  minSimilarity: Number(process.env.RAG_MIN_SIMILARITY ?? 0.25),
};
