"use client";

import { useState } from "react";
import type { AssessResponse, Designation } from "@/lib/types";
import { ResultsPanel } from "@/components/results-panel";

type Mode = "url" | "text";

const DESIGNATIONS: { value: string; label: string }[] = [
  { value: "auto", label: "Auto (let the model decide)" },
  { value: "ARTICLE", label: "News article" },
  { value: "OPINION", label: "Opinion / editorial" },
  { value: "POST", label: "Social-media post" },
  { value: "DOCUMENTARY", label: "Documentary / research" },
  { value: "SATIRE", label: "Satire" },
];

export default function Home() {
  const [mode, setMode] = useState<Mode>("url");
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [title, setTitle] = useState("");
  const [designation, setDesignation] = useState("auto");
  const [language, setLanguage] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stopReason, setStopReason] = useState<string | null>(null);
  const [result, setResult] = useState<AssessResponse | null>(null);

  async function runAssessment() {
    setLoading(true);
    setError(null);
    setStopReason(null);
    setResult(null);
    try {
      const body: Record<string, string> = {};
      if (mode === "url") body.url = url.trim();
      else {
        body.text = text.trim();
        if (title.trim()) body.title = title.trim();
      }
      if (designation !== "auto") body.designation = designation as Designation;
      if (language.trim()) body.language = language.trim();

      const res = await fetch("/api/assess", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const contentType = res.headers.get("content-type") || "";
      const data = contentType.includes("application/json")
        ? await res.json()
        : { error: res.status === 504 ? "Assessment service timed out. Please try again." : "Assessment service unavailable." };
      if (!res.ok) {
        if (data.stop_reason) setStopReason(String(data.stop_reason));
        throw new Error(data.error || "Assessment failed.");
      }
      setResult(data as AssessResponse);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  const canSubmit =
    !loading && (mode === "url" ? url.trim().length > 0 : text.trim().length > 0);

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-12 sm:py-16">
      <header className="mb-8">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-indigo-300">
            <span className="h-1.5 w-1.5 rounded-full bg-indigo-400" />
            PTS · Publication Trust Score
          </div>
          <a
            href="/PTS-Overview.pdf"
            download="PTS-Overview.pdf"
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:border-indigo-400/50 hover:bg-white/10 hover:text-white"
          >
            <DownloadIcon /> Download framework (PDF)
          </a>
        </div>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Publication Trust Score
        </h1>
        <p className="mt-2 max-w-xl text-sm leading-6 text-zinc-400">
          Assess a single publication on two independent 100-point scores:{" "}
          <span className="text-zinc-200">PTS-A</span> for antisemitism (IHRA
          Working Definition) and{" "}
          <span className="text-zinc-200">PTS-J</span> for journalistic standards
          (IMPRESS Standards Code). The model adjudicates each criterion with a
          graded severity; a deterministic scorer verifies every quote, runs a
          coded-language pre-scan, resolves designated organisations from
          versioned lists, and reports{" "}
          <span className="text-zinc-200">coverage</span> and{" "}
          <span className="text-zinc-200">confidence</span> alongside the score. A
          definitive 100 must be earned — absence of a detected violation is not
          treated as demonstrated compliance. The two scores are never blended.
        </p>
      </header>

      <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 shadow-2xl backdrop-blur sm:p-6">
        <div className="mb-4 inline-flex rounded-lg border border-white/10 bg-black/30 p-1 text-sm">
          {(["url", "text"] as Mode[]).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`rounded-md px-4 py-1.5 font-medium transition-colors ${
                mode === m
                  ? "bg-indigo-500 text-white"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              {m === "url" ? "From URL" : "Paste text"}
            </button>
          ))}
        </div>

        {mode === "url" ? (
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && canSubmit && runAssessment()}
            placeholder="https://example.com/news/article"
            className="w-full rounded-lg border border-white/10 bg-black/40 px-4 py-3 text-sm outline-none placeholder:text-zinc-600 focus:border-indigo-400"
          />
        ) : (
          <div className="space-y-3">
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Headline (optional)"
              className="w-full rounded-lg border border-white/10 bg-black/40 px-4 py-2.5 text-sm outline-none placeholder:text-zinc-600 focus:border-indigo-400"
            />
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Paste the full publication text here…"
              rows={8}
              className="w-full resize-y rounded-lg border border-white/10 bg-black/40 px-4 py-3 text-sm leading-6 outline-none placeholder:text-zinc-600 focus:border-indigo-400"
            />
          </div>
        )}

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-xs text-zinc-500">Designation</span>
            <select
              value={designation}
              onChange={(e) => setDesignation(e.target.value)}
              className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm outline-none focus:border-indigo-400"
            >
              {DESIGNATIONS.map((d) => (
                <option key={d.value} value={d.value} className="bg-zinc-900">
                  {d.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-zinc-500">
              Language hint (optional)
            </span>
            <input
              type="text"
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              placeholder="ISO 639-1, e.g. en, de, pl"
              className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm outline-none placeholder:text-zinc-600 focus:border-indigo-400"
            />
          </label>
        </div>

        <div className="mt-4 flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
          <p className="text-xs text-zinc-500">
            {mode === "url"
              ? "Some sites block bots or require login — switch to Paste text if extraction fails."
              : "For social-media content, paste the text and set the designation to Post."}
          </p>
          <button
            onClick={runAssessment}
            disabled={!canSubmit}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-500 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto"
          >
            {loading ? (
              <>
                <Spinner /> Assessing…
              </>
            ) : (
              "Run assessment"
            )}
          </button>
        </div>
      </section>

      {error && (
        <div className="mt-6 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
          {stopReason && (
            <span className="mt-1 block text-xs text-red-300/80">
              stop_reason: <code className="font-mono">{stopReason}</code>
            </span>
          )}
        </div>
      )}

      {loading && !result && (
        <div className="mt-8 space-y-4">
          <div className="h-28 animate-pulse rounded-2xl border border-white/5 bg-white/[0.03]" />
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-24 animate-pulse rounded-2xl border border-white/5 bg-white/[0.03]"
            />
          ))}
        </div>
      )}

      {result && (
        <ResultsPanel
          score={result.score}
          assessment={result.assessment}
          parts={result.parts}
        />
      )}

      {!result && !loading && !error && (
        <p className="mt-10 text-center text-xs text-zinc-600">
          Real scoring needs a model key. Set{" "}
          <code className="text-zinc-400">OPENROUTER_API_KEY</code> or{" "}
          <code className="text-zinc-400">ANTHROPIC_API_KEY</code>. Without a key
          the app returns{" "}
          <code className="text-zinc-400">ANALYSIS_UNAVAILABLE</code> rather than a
          score — it never fabricates a passing result.
        </p>
      )}
    </main>
  );
}

function Spinner() {
  return (
    <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
  );
}

function DownloadIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}
