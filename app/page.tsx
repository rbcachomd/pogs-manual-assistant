"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";

const PDF_URL = "/docs/pogs-administrative-manual.pdf";

type Source = {
  marker: string;
  id: number;
  section: string;
  pageStart: number;
  pageEnd: number;
  similarity: number;
  content: string;
};
type SearchOutput = { query: string; results: Source[] };

const SUGGESTIONS: { group: string; q: string }[] = [
  { group: "Membership", q: "What are the requirements for a Diplomate to be admitted as a Fellow?" },
  { group: "Membership", q: "When is a Fellow considered in good standing?" },
  { group: "Governance", q: "What are the qualifications to run for Vice President?" },
  { group: "Committees", q: "What are the functions of the Committee on Credentials and Membership?" },
  { group: "Finance", q: "What are the levels of approval for disbursements according to amount?" },
  { group: "Protocol", q: "What is the proper seating arrangement during official POGS functions?" },
];

/** Gather unique sources from every searchManual tool result in a message, in first-seen order. */
function collectSources(message: UIMessage): Source[] {
  const seen = new Map<number, Source>();
  for (const part of message.parts) {
    if (part.type === "tool-searchManual" && part.state === "output-available") {
      const out = part.output as SearchOutput;
      for (const r of out.results) if (!seen.has(r.id)) seen.set(r.id, r);
    }
  }
  return [...seen.values()];
}

function pages(s: Source) {
  return s.pageStart === s.pageEnd ? `p. ${s.pageStart}` : `pp. ${s.pageStart}–${s.pageEnd}`;
}

/** Turn [#12] or [#12, #15] markers into numbered citation links. */
function linkCitations(text: string, numberOf: Map<number, number>) {
  return text.replace(/\[(#\d+(?:\s*,\s*#\d+)*)\]/g, (_, group: string) =>
    group
      .split(",")
      .map((m) => Number(m.trim().slice(1)))
      .map((id) => (numberOf.has(id) ? `[${numberOf.get(id)}](cite:${id})` : ""))
      .join(""),
  );
}

export default function Home() {
  const [input, setInput] = useState("");
  const [highlight, setHighlight] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const { messages, sendMessage, status, error, stop, setMessages } = useChat({
    transport: new DefaultChatTransport({ api: "/api/chat" }),
  });
  const busy = status === "submitted" || status === "streaming";

  // Warm the server and vector index while the visitor reads the empty state.
  useEffect(() => {
    fetch("/api/health").catch(() => {});
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, status]);

  const ask = (q: string) => {
    const text = q.trim();
    if (!text || busy) return;
    sendMessage({ text });
    setInput("");
  };

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-10 border-b border-line bg-surface/90 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-md bg-brand text-sm font-semibold text-white">AM</div>
            <div>
              <h1 className="text-[15px] font-semibold leading-tight">POGS Administrative Manual Assistant</h1>
              <p className="text-xs text-muted">Answers grounded in the Administrative Manual 2026, with page citations</p>
            </div>
          </div>
          {messages.length > 0 && (
            <button
              onClick={() => setMessages([])}
              className="rounded-md border border-line px-3 py-1.5 text-xs text-muted hover:bg-panel"
            >
              New chat
            </button>
          )}
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-40 pt-6">
        {messages.length === 0 ? (
          <EmptyState onPick={ask} />
        ) : (
          <div className="space-y-8">
            {messages.map((m) =>
              m.role === "user" ? (
                <UserBubble key={m.id} message={m} />
              ) : (
                <AssistantMessage key={m.id} message={m} highlight={highlight} onCite={setHighlight} />
              ),
            )}
            {status === "submitted" && <p className="text-sm text-muted animate-pulse">Consulting the manual…</p>}
            {error && (
              <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
                Something went wrong while answering. Please try again.
              </div>
            )}
          </div>
        )}
        <div ref={bottomRef} />
      </main>

      <footer className="fixed inset-x-0 bottom-0 border-t border-line bg-surface/95 backdrop-blur">
        <form
          className="mx-auto flex max-w-3xl items-end gap-2 px-4 py-3"
          onSubmit={(e) => {
            e.preventDefault();
            ask(input);
          }}
        >
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                ask(input);
              }
            }}
            rows={1}
            maxLength={2000}
            placeholder="Ask a question about the manual…"
            className="max-h-40 min-h-[44px] flex-1 resize-none rounded-lg border border-line bg-panel px-3 py-2.5 text-[15px] outline-none focus:border-brand"
            aria-label="Your question"
          />
          {busy ? (
            <button type="button" onClick={stop} className="h-11 rounded-lg border border-line px-4 text-sm">
              Stop
            </button>
          ) : (
            <button
              type="submit"
              disabled={!input.trim()}
              className="h-11 rounded-lg bg-brand px-4 text-sm font-medium text-white disabled:opacity-40"
            >
              Ask
            </button>
          )}
        </form>
        <p className="mx-auto max-w-3xl px-4 pb-2 text-[11px] text-muted">
          Reference aid only. The official, BOT-approved text of the manual prevails. Verify citations before acting.
        </p>
      </footer>
    </div>
  );
}

function EmptyState({ onPick }: { onPick: (q: string) => void }) {
  return (
    <section className="pt-4">
      <h2 className="text-2xl font-semibold tracking-tight">How can the Administrative Manual help you today?</h2>
      <p className="mt-2 max-w-prose text-[15px] leading-relaxed text-muted">
        Ask in plain language about POGS policies and procedures. Every answer is drawn only from the
        <span className="font-medium text-fg"> POGS Administrative Manual 2026</span> (135 pages, 15 chapters) and cites the
        exact section and page, with a link to the source PDF.
      </p>
      <h3 className="mt-6 text-xs font-semibold uppercase tracking-wider text-muted">Coverage</h3>
      <div className="mt-2 grid grid-cols-2 gap-x-4 text-[13px] text-muted sm:grid-cols-3">
        {["Membership & good standing", "Governance & officers", "Committees", "PBOG & CREED", "Regions & chapters", "Finance, protocol & facilities"].map(
          (t) => (
            <div key={t} className="flex items-center gap-2 py-1">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand" />
              {t}
            </div>
          ),
        )}
      </div>
      <h3 className="mt-8 text-xs font-semibold uppercase tracking-wider text-muted">Try a question</h3>
      <div className="mt-3 flex flex-col gap-2">
        {SUGGESTIONS.map((s) => (
          <button
            key={s.q}
            onClick={() => onPick(s.q)}
            className="group flex items-start gap-3 rounded-lg border border-line bg-surface px-3 py-2.5 text-left text-[14px] hover:border-brand hover:bg-panel"
          >
            <span className="mt-0.5 shrink-0 rounded bg-brand-soft px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand">
              {s.group}
            </span>
            <span>{s.q}</span>
          </button>
        ))}
      </div>
      <p className="mt-6 text-xs text-muted">
        Questions outside the manual&apos;s scope will be declined rather than answered from general knowledge.
      </p>
    </section>
  );
}

function UserBubble({ message }: { message: UIMessage }) {
  const text = message.parts.map((p) => (p.type === "text" ? p.text : "")).join("");
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-brand px-4 py-2.5 text-[15px] text-white">
        {text}
      </div>
    </div>
  );
}

function AssistantMessage({
  message,
  highlight,
  onCite,
}: {
  message: UIMessage;
  highlight: string | null;
  onCite: (key: string) => void;
}) {
  const sources = useMemo(() => collectSources(message), [message]);
  const numberOf = useMemo(() => new Map(sources.map((s, i) => [s.id, i + 1])), [sources]);
  const text = message.parts.map((p) => (p.type === "text" ? p.text : "")).join("");
  const searches = message.parts.filter((p) => p.type === "tool-searchManual");
  const citedIds = new Set([...text.matchAll(/#(\d+)/g)].map((m) => Number(m[1])));
  const keyFor = (id: number) => `${message.id}-${id}`;

  return (
    <article className="space-y-3">
      {searches.map((p, i) => {
        if (p.type !== "tool-searchManual") return null;
        const q = (p.input as { query?: string } | undefined)?.query;
        const done = p.state === "output-available";
        const n = done ? (p.output as SearchOutput).results.length : 0;
        return (
          <div key={i} className="flex items-center gap-2 text-xs text-muted">
            <span className={`h-1.5 w-1.5 rounded-full ${done ? "bg-emerald-500" : "animate-pulse bg-amber-500"}`} />
            {done ? `Searched the manual for “${q}” · ${n} passage${n === 1 ? "" : "s"}` : `Searching the manual${q ? ` for “${q}”` : ""}…`}
          </div>
        );
      })}

      {text && (
        <div className="prose-answer text-[15px] leading-relaxed">
          <ReactMarkdown
            urlTransform={(u) => u}
            components={{
              a: ({ href, children }) => {
                if (href?.startsWith("cite:")) {
                  const id = Number(href.slice(5));
                  return (
                    <a
                      href={`#src-${keyFor(id)}`}
                      onClick={() => onCite(keyFor(id))}
                      className="cite"
                      title="Jump to source"
                    >
                      {children}
                    </a>
                  );
                }
                return (
                  <a href={href} target="_blank" rel="noreferrer" className="underline">
                    {children}
                  </a>
                );
              },
            }}
          >
            {linkCitations(text, numberOf)}
          </ReactMarkdown>
        </div>
      )}

      {sources.length > 0 && (
        <details className="rounded-lg border border-line bg-panel" open={citedIds.size > 0}>
          <summary className="cursor-pointer select-none px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted">
            Sources · {sources.length} passage{sources.length === 1 ? "" : "s"} retrieved
          </summary>
          <ol className="space-y-2 px-3 pb-3">
            {sources.map((s, i) => {
              const k = keyFor(s.id);
              const cited = citedIds.has(s.id);
              return (
                <li
                  key={s.id}
                  id={`src-${k}`}
                  className={`scroll-mt-24 rounded-md border bg-surface p-3 transition-colors ${
                    highlight === k ? "border-brand ring-2 ring-brand/30" : "border-line"
                  } ${cited ? "" : "opacity-70"}`}
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div className="text-[13px] font-medium">
                      <span className="mr-1.5 inline-grid h-5 min-w-5 place-items-center rounded bg-brand px-1 text-[11px] text-white">
                        {i + 1}
                      </span>
                      {s.section}
                    </div>
                    <a
                      href={`${PDF_URL}#page=${s.pageStart}`}
                      target="_blank"
                      rel="noreferrer"
                      className="shrink-0 text-xs font-medium text-brand underline-offset-2 hover:underline"
                    >
                      Open PDF · {pages(s)} ↗
                    </a>
                  </div>
                  <details className="mt-1.5">
                    <summary className="cursor-pointer text-xs text-muted">
                      {cited ? "Cited" : "Retrieved, not cited"} · relevance {Math.round(s.similarity * 100)}% · show excerpt
                    </summary>
                    <p className="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed text-muted">{s.content}</p>
                  </details>
                </li>
              );
            })}
          </ol>
        </details>
      )}
    </article>
  );
}
