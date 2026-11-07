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

const COVERAGE: { label: string; ref: string }[] = [
  { label: "Membership and good standing", ref: "Chapter 1 · pages 1–8" },
  { label: "Governance and officers", ref: "Chapter 2 · pages 9–19" },
  { label: "Committees", ref: "Chapter 3 · pages 20–50" },
  { label: "PBOG and CREED", ref: "Chapters 4–5 · pages 51–60" },
  { label: "Regions and chapters", ref: "Chapter 7 · pages 64–72" },
  { label: "Finance, protocol and facilities", ref: "Chapters 10, 12, 15" },
];

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
            <div className="seal-mark grid h-10 w-10 shrink-0 place-items-center rounded-full">
              <span className="font-display text-[15px] text-brand">AM</span>
            </div>
            <div>
              <h1 className="font-serif text-[17px] font-normal leading-tight">POGS Administrative Manual Assistant</h1>
              <p className="text-xs text-faint">Answers grounded in the Administrative Manual 2026, with page citations</p>
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
              className="h-11 rounded-lg bg-brand px-5 text-sm font-semibold text-on-brand transition-colors hover:bg-brand-deep disabled:opacity-40"
            >
              Ask
            </button>
          )}
        </form>
        <p className="mx-auto max-w-3xl px-4 pb-2 text-[11px] text-muted">
          Reference aid only. The official, BOT-approved text of the Manual prevails. Verify citations before acting.
          <span className="block">
            Developed by Richard Ronald B. Cacho, MD, MHA, Public Relations Officer (2026)
          </span>
        </p>
      </footer>
    </div>
  );
}

function EmptyState({ onPick }: { onPick: (q: string) => void }) {
  return (
    <section className="pt-2">
      <p className="font-serif text-[19px] italic leading-none text-brand">Ask in plain language</p>
      <h2 className="mt-4 font-display text-[clamp(2.1rem,6vw,3.5rem)] font-normal leading-[1.02] tracking-[-0.02em]">
        How can the Administrative Manual help you today?
      </h2>
      <p className="mt-5 max-w-[54ch] font-serif text-[18px] leading-[1.6] text-muted">
        Answers are drawn only from the{" "}
        <span className="border-b border-accent pb-px text-fg">Administrative Manual 2026</span> — 135 pages, 15
        chapters — and cite the exact section, the page, and a link to the source PDF.
      </p>

      <div className="band mt-10 rounded-xl px-5 py-5 sm:px-6">
        <h3 className="band-accent font-serif text-[18px] italic">What it covers</h3>
        <p className="band-muted mt-1 text-[13px]">
          All fifteen chapters are indexed. Chapter and page ranges follow the 2026 edition.
        </p>
        <div className="band-rule mt-5 grid grid-cols-1 gap-px overflow-hidden rounded-lg sm:grid-cols-2">
          {COVERAGE.map((c) => (
            <div key={c.label} className="band px-4 py-3.5">
              <b className="block font-serif text-[16px] font-normal leading-snug">{c.label}</b>
              <i className="band-muted mt-1 block text-[12px] not-italic tabular-nums">{c.ref}</i>
            </div>
          ))}
        </div>
      </div>

      <h3 className="mt-12 font-serif text-[22px] font-normal tracking-tight">Try a question</h3>
      <p className="mt-1 text-[14px] text-muted">
        Each one is answered from the Manual, with the section and page cited.
      </p>
      <div className="mt-5 border-t border-fg">
        {SUGGESTIONS.map((s) => (
          <button
            key={s.q}
            onClick={() => onPick(s.q)}
            className="group grid w-full grid-cols-1 items-baseline gap-y-1.5 border-b border-line-soft py-4 pr-3 text-left transition-all hover:bg-panel hover:pl-3 sm:grid-cols-[112px_1fr] sm:gap-x-5 sm:gap-y-0"
          >
            <span className="text-[11px] font-semibold tracking-[0.07em] text-accent sm:pt-1">{s.group}</span>
            <span className="font-serif text-[17px] leading-snug text-fg transition-colors group-hover:text-brand">
              {s.q}
            </span>
          </button>
        ))}
      </div>

      <div className="mt-10 border-l-[3px] border-accent bg-panel px-5 py-4">
        <p className="max-w-[60ch] font-serif text-[16px] leading-relaxed text-muted">
          Questions outside the Manual&apos;s scope are declined rather than answered from general knowledge.
        </p>
      </div>

      <div className="mt-10 border-t border-line pt-4 text-xs leading-relaxed text-faint">
        Developed by{" "}
        <span className="font-serif text-[15px] text-fg">Richard Ronald B. Cacho, MD, MHA</span>
        <br />
        Public Relations Officer (2026), Philippine Obstetrical and Gynecological Society
      </div>
    </section>
  );
}

function UserBubble({ message }: { message: UIMessage }) {
  const text = message.parts.map((p) => (p.type === "text" ? p.text : "")).join("");
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-brand px-4 py-2.5 text-[15px] text-on-brand">
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
                      <span className="mr-1.5 inline-grid h-5 min-w-5 place-items-center rounded bg-brand px-1 text-[11px] text-on-brand">
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
                      {cited ? "Cited" : "Retrieved, not cited"} · {s.similarity > 0 ? `semantic match ${Math.round(s.similarity * 100)}%` : "keyword match"} · show excerpt
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
