import { NextRequest, NextResponse } from "next/server";
import { extractFromUrl, fromRawText } from "@/lib/extract";
import { scoreFromParts } from "@/lib/assess";
import { MIN_BODY_CHARS } from "@/lib/rubric";
import { normaliseAssessmentRequest, RequestValidationError } from "@/lib/request";
import type { ArticleParts } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 120;

type Stage = "request-parse" | "request-validation" | "article-extraction" | "article-parsing" | "model-request" | "scoring";

function logFailure(stage: Stage, field: string | undefined, value: unknown, error: unknown): void {
  const e = error instanceof Error ? error : new Error(String(error));
  console.error("[pts:assessment] stage failed", {
    stage,
    field,
    valueShape: Array.isArray(value) ? `array(${value.length})` : typeof value,
    valueLength: typeof value === "string" ? value.length : undefined,
    errorClass: e.constructor.name,
    errorName: e.name,
    errorMessage: e.message,
    stack: e.stack,
  });
}

export async function POST(req: NextRequest) {
  let payload: unknown;
  try {
    payload = await req.json();
  } catch (error) {
    logFailure("request-parse", undefined, undefined, error);
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  let input;
  try {
    input = normaliseAssessmentRequest(payload);
  } catch (error) {
    const field = error instanceof RequestValidationError ? error.field : undefined;
    const value = field && payload && typeof payload === "object" ? (payload as Record<string, unknown>)[field] : undefined;
    logFailure("request-validation", field, value, error);
    return NextResponse.json(
      { error: error instanceof RequestValidationError ? error.message : "Assessment request validation failed." },
      { status: 400 },
    );
  }

  const { url, text, title, designation, language } = input;

  try {
    let parts: ArticleParts;

    if (url) {
      try {
        parts = await extractFromUrl(url);
      } catch (e) {
        logFailure("article-extraction", "url", url, e);
        return NextResponse.json(
          { error: "Article extraction failed. The site may block automated access; paste the article text instead." },
          { status: 422 },
        );
      }
    } else {
      parts = fromRawText(text!, {
        headline: title,
        language,
      });
    }

    if (parts.body.trim().length < MIN_BODY_CHARS) {
      return NextResponse.json(
        {
          error:
            `Publication text is too short to assess (under ${MIN_BODY_CHARS} characters). ` +
            (url
              ? "This usually means a paywall, cookie/consent wall or a social-media page was fetched instead of the article. Paste the full text directly."
              : "Paste the full publication text."),
        },
        { status: 422 },
      );
    }

    let result;
    try {
      result = await scoreFromParts(parts, { designation, languageHint: language });
    } catch (error) {
      logFailure("model-request", undefined, undefined, error);
      throw error;
    }

    // Production safety: no real provider → no PTS result (never 100/100).
    if (result.score.analysis_unavailable) {
      return NextResponse.json(
        {
          error: "ANALYSIS_UNAVAILABLE",
          detail:
            result.score.note ||
            "No model provider is configured, so no PTS result can be produced.",
        },
        { status: 503 },
      );
    }

    const debug =
      req.nextUrl.searchParams.get("debug") === "1" ||
      process.env.PTS_DEBUG === "1";

    if (debug) {
      return NextResponse.json({
        ...result,
        debug: {
          provider:
            process.env.OPENROUTER_API_KEY
              ? "openrouter"
              : process.env.ANTHROPIC_API_KEY
                ? "anthropic"
                : "mock",
          stop_reason: result.score.provenance?.stop_reason,
          usage: result.score.provenance?.usage,
          lexicon_hits: result.score.lexicon_hits,
          org_resolutions: result.score.org_resolutions,
          raw_assessment: result.assessment,
        },
      });
    }

    return NextResponse.json(result);
  } catch (e) {
    logFailure("scoring", undefined, undefined, e);
    const stopReason = (e as { stop_reason?: string })?.stop_reason;
    const isModelError = e instanceof Error && e.name === "ModelError";
    return NextResponse.json(
      {
        error: isModelError ? "Model response validation failed." : "Assessment service unavailable.",
        ...(stopReason ? { stop_reason: stopReason } : {}),
      },
      { status: isModelError ? 502 : 500 },
    );
  }
}
