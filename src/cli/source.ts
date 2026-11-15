import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { failure } from "@ambitious/kit/domain/failure";
import { refuseAgentData } from "@ambitious/kit/paths/refuse-agent-data";
import { normalizeText } from "../domain/quotes.ts";

export function readSource(path: string) {
  const sourcePath = refuseAgentData(path);
  let bytes: Buffer;
  let text: string;
  try {
    bytes = readFileSync(sourcePath);
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw failure("E_INPUT_SCHEMA", "The source file could not be read as UTF-8 text.", "Pass a readable UTF-8 text file. Convert PDF documents to text before ingesting them.");
  }
  if (text.startsWith("%PDF-") || text.includes("\u0000") || text.trim() === "") {
    throw failure("E_INPUT_SCHEMA", "The source must contain nonempty text.", "Convert PDF or binary documents to UTF-8 text before ingesting them.");
  }
  return {
    sourcePath,
    sourceSha256: createHash("sha256").update(bytes).digest("hex"),
    textNormalized: normalizeText(text),
  };
}
