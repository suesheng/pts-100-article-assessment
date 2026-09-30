import assert from "node:assert/strict";
import test from "node:test";
import {
  normaliseAssessmentRequest,
  normaliseArticleUrl,
  normaliseDesignation,
  normaliseLanguage,
  RequestValidationError,
} from "../src/lib/request";

const GUARDIAN = "https://www.theguardian.com/commentisfree/2025/nov/08/where-is-gaza-peace-process-going";

test("Guardian URL with auto designation and empty language is accepted", () => {
  const input = normaliseAssessmentRequest({ url: GUARDIAN, designation: "auto", language: "" });
  assert.equal(input.url, GUARDIAN);
  assert.equal(input.designation, undefined);
  assert.equal(input.language, undefined);
});

test("valid URL with explicit en language is accepted", () => {
  const input = normaliseAssessmentRequest({ url: GUARDIAN, language: "en" });
  assert.equal(input.language, "en");
});

test("malformed URL returns a clear validation message", () => {
  assert.throws(
    () => normaliseArticleUrl("not a URL"),
    (error) => error instanceof RequestValidationError && error.message.startsWith("Invalid article URL"),
  );
});

test("empty optional language is not validated as an ISO code", () => {
  assert.equal(normaliseLanguage("   "), undefined);
});

test("auto display designation maps to no caller override", () => {
  assert.equal(normaliseDesignation("Auto (let the model decide)"), undefined);
  assert.equal(normaliseDesignation("OPINION"), "OPINION");
});

test("boundary hidden characters are removed from a valid URL", () => {
  assert.equal(normaliseArticleUrl(`\uFEFF${GUARDIAN}\u200B`), GUARDIAN);
});
