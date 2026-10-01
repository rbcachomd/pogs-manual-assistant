import { openai } from "@ai-sdk/openai";
import { convertToModelMessages, stepCountIs, streamText, tool, type UIMessage } from "ai";
import { z } from "zod";
import { CORPUS, RAG } from "@/lib/config";
import { searchManual } from "@/lib/retrieval";

export const runtime = "nodejs";
export const maxDuration = 60;

const SYSTEM = `You are the ${CORPUS.title} Assistant, a reference aid for members, officers, and secretariat staff of the Philippine Obstetrical and Gynecological Society (POGS).

GROUNDING RULES
- You MUST call the searchManual tool before answering any question about POGS policies, procedures, governance, membership, committees, elections, finances, chapters, or forms. Never answer such questions from general knowledge.
- Answer ONLY from the passages the tool returns. If the passages do not contain the answer, say plainly: "The Administrative Manual passages I retrieved do not address this." Then suggest a more specific question or the relevant office to consult. Do not guess.
- If the first search is weak or off-target, search again with different wording (e.g. the formal term used in the manual) before giving up. At most 3 searches.
- Cite every factual sentence with the passage marker exactly as given, e.g. [#42]. Use several markers if a sentence draws on several passages. Never invent markers.

STYLE
- Formal, concise, institutionally precise. Lead with the direct answer, then the supporting detail.
- Use numbered steps for procedures and short bullet lists for requirements. Quote exact figures, deadlines, and officer titles as written.
- For greetings or questions about what you can do, reply briefly without searching and describe the manual's scope.`;

const searchTool = tool({
  description: `Semantic search over the ${CORPUS.title}: the official source of POGS administrative policies and procedures (governance, Board and officers, committees, membership categories and requirements, dues, elections, chapters, meetings, finance and disbursement, secretariat procedures, forms). Use it for ANY question about how POGS operates. Input a focused query using the manual's likely wording. Returns passages with a marker id, section heading, and page numbers.`,
  inputSchema: z.object({
    query: z.string().min(2).max(300).describe("Focused search query, e.g. 'requirements for Fellowship status' or 'chapter officer election procedure'"),
  }),
  execute: async ({ query }) => {
    const chunks = await searchManual(query);
    return {
      query,
      results: chunks.map((c) => ({
        marker: `#${c.id}`,
        id: c.id,
        section: c.section,
        pageStart: c.pageStart,
        pageEnd: c.pageEnd,
        similarity: Number(c.similarity.toFixed(3)),
        content: c.content,
      })),
    };
  },
});

export async function POST(req: Request) {
  let messages: UIMessage[];
  try {
    ({ messages } = await req.json());
  } catch {
    return new Response("Invalid request body", { status: 400 });
  }
  if (!Array.isArray(messages) || messages.length === 0) {
    return new Response("No messages", { status: 400 });
  }

  // Guardrails against abuse: cap history length and message size.
  const recent = messages.slice(-12);
  const last = recent[recent.length - 1];
  const lastText = last.parts?.map((p) => (p.type === "text" ? p.text : "")).join("") ?? "";
  if (lastText.length > 2000) {
    return new Response("Question is too long (max 2,000 characters).", { status: 413 });
  }

  const result = streamText({
    model: openai(RAG.chatModel),
    system: SYSTEM,
    messages: convertToModelMessages(recent),
    tools: { searchManual: searchTool },
    stopWhen: stepCountIs(5),
    temperature: 0.1,
  });

  return result.toUIMessageStreamResponse({
    onError: (err) => {
      console.error("[chat] stream error", err);
      return "The assistant is temporarily unavailable. Please try again in a moment.";
    },
  });
}
