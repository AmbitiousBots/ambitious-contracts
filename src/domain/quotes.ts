import type { QuoteRejectionCode } from "./types.ts";

export type QuoteVerification =
  | Readonly<{ ok: true; quote: string; start: number; end: number }>
  | Readonly<{
      ok: false;
      code: QuoteRejectionCode;
      why: string;
    }>;

export const normalizeText = (text: string): string => text.normalize("NFC").replace(/\s+/gu, " ").trim();

export function verifyQuote(text: string, quote: string): QuoteVerification {
  const start = quote.length === 0 ? -1 : text.indexOf(quote);
  if (start < 0) {
    return {
      ok: false,
      code: "E_QUOTE_NOT_LITERAL",
      why: "The quote must exactly match a nonempty span of the normalized contract text.",
    };
  }
  if (text.indexOf(quote, start + 1) >= 0) {
    return {
      ok: false,
      code: "E_AMBIGUOUS_QUOTE",
      why: "The quote occurs more than once. Include enough surrounding text to identify one clause.",
    };
  }
  return { ok: true, quote, start, end: start + quote.length };
}
