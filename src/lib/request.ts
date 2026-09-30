import type { Designation } from "./types";

export type AssessmentRequest = {
  url?: string;
  text?: string;
  title?: string;
  designation?: string;
  language?: string;
};

export type NormalisedAssessmentRequest = {
  url?: string;
  text?: string;
  title?: string;
  designation?: Designation;
  language?: string;
};

export class RequestValidationError extends Error {
  readonly field: keyof AssessmentRequest;

  constructor(field: keyof AssessmentRequest, message: string) {
    super(message);
    this.name = "RequestValidationError";
    this.field = field;
  }
}

const DESIGNATIONS = new Set<Designation>([
  "ARTICLE",
  "OPINION",
  "POST",
  "DOCUMENTARY",
  "SATIRE",
]);

// Browsers can preserve pasted zero-width/BOM characters at input boundaries.
const trimInput = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const trimmed = value
    .replace(/^[\s\u200B-\u200D\u2060\uFEFF]+|[\s\u200B-\u200D\u2060\uFEFF]+$/gu, "")
    .trim();
  return trimmed || undefined;
};

export function normaliseDesignation(value: unknown): Designation | undefined {
  const raw = trimInput(value);
  if (!raw || raw.toLowerCase() === "auto" || raw.toLowerCase() === "auto (let the model decide)") {
    return undefined;
  }
  const designation = raw.toUpperCase() as Designation;
  if (!DESIGNATIONS.has(designation)) {
    throw new RequestValidationError("designation", `Unknown designation: ${raw}`);
  }
  return designation;
}

export function normaliseLanguage(value: unknown): string | undefined {
  const language = trimInput(value);
  if (!language) return undefined;
  if (!/^[a-z]{2}$/i.test(language)) {
    throw new RequestValidationError("language", "Language hint must be a two-letter ISO 639-1 code, for example en.");
  }
  return language.toLowerCase();
}

export function normaliseArticleUrl(value: unknown): string | undefined {
  const raw = trimInput(value);
  if (!raw) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new RequestValidationError("url", "Invalid article URL. Enter an absolute http:// or https:// URL.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new RequestValidationError("url", "Invalid article URL. Only http:// and https:// URLs are supported.");
  }
  return parsed.toString();
}

export function normaliseAssessmentRequest(payload: unknown): NormalisedAssessmentRequest {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new RequestValidationError("text", "Assessment request validation failed.");
  }
  const body = payload as AssessmentRequest;
  const url = normaliseArticleUrl(body.url);
  const text = trimInput(body.text);
  if (!url && !text) {
    throw new RequestValidationError("text", "Provide either an article URL or article text.");
  }
  return {
    url,
    text,
    title: trimInput(body.title),
    designation: normaliseDesignation(body.designation),
    language: normaliseLanguage(body.language),
  };
}
