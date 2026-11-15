import assert from "node:assert/strict";
import { test } from "node:test";
import * as fc from "fast-check";
import { normalizeText, verifyQuote } from "../src/domain/quotes.ts";

test("ingest normalization composes Unicode and collapses whitespace once", () => {
  assert.equal(normalizeText(" \n Cafe\u0301\t  delivers\r\na report. \n"), "Café delivers a report.");
});

test("verified quotes preserve their exact span in normalized text", () => {
  const text = normalizeText("Terms.\n\nThe provider delivers a report.\tEnd.");
  const result = verifyQuote(text, "The provider delivers a report.");
  assert.deepEqual(result, { ok: true, quote: "The provider delivers a report.", start: 7, end: 38 });
  assert.equal(text.slice(7, 38), "The provider delivers a report.");
});

test("paraphrased and empty quotes cannot be verified", () => {
  const text = "The provider delivers a report.";
  assert.deepEqual(verifyQuote(text, "The provider sends a report.").ok, false);
  const result = verifyQuote(text, "");
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "E_QUOTE_NOT_LITERAL");
});

test("proposal quotes are never silently normalized or case folded", () => {
  const text = normalizeText("Cafe\u0301\n  delivers a report.");
  for (const quote of ["Cafe\u0301 delivers", "Café  delivers", "café delivers"]) {
    const result = verifyQuote(text, quote);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "E_QUOTE_NOT_LITERAL");
  }
});

test("repeated and overlapping spans require a more specific quote", () => {
  for (const [text, quote] of [["One report. Two reports.", "report"], ["aaaa", "aaa"]]) {
    assert.ok(text !== undefined && quote !== undefined);
    const result = verifyQuote(text, quote);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "E_AMBIGUOUS_QUOTE");
  }
});

test("quote offsets use JavaScript UTF-16 indices including supplementary characters", () => {
  const text = "📄 Terms. Submit café report.";
  const quote = "Submit café report.";
  const result = verifyQuote(text, quote);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.start, 10);
    assert.equal(text.slice(result.start, result.end), quote);
  }
});

test("every generated accepted quote is exactly one literal span", () => {
  const word = fc.array(fc.constantFrom("a", "b", "c", "é", "中", "📄"), { minLength: 1, maxLength: 80 }).map((parts) => parts.join(""));
  fc.assert(fc.property(word, (quote) => {
    const text = normalizeText(`Beginning. [${quote}] End.`);
    const result = verifyQuote(text, quote);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(text.slice(result.start, result.end), quote);
      assert.equal(text.indexOf(quote), result.start);
      assert.equal(text.indexOf(quote, result.start + 1), -1);
    }
    const duplicate = verifyQuote(`${text} [${quote}]`, quote);
    assert.equal(duplicate.ok, false);
    if (!duplicate.ok) assert.equal(duplicate.code, "E_AMBIGUOUS_QUOTE");
  }), { seed: 44110, numRuns: 1000 });
});
