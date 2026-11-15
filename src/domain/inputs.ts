import { failure } from "@ambitious/kit/domain/failure";
import { isRecord } from "@ambitious/kit/domain/json";
import { isCalendarDate, parseRecurrence } from "./recurrence.ts";
import { isClauseRef, isContractId, isObligationId, isParty } from "./types.ts";

export type IngestInput = Readonly<{ title: string; party: string; path: string; effective_from: string | null; effective_to: string | null }>;
export type ProposalInput = Readonly<{ summary: string; party: string; clause_ref: string; quote: string; recurrence: string | null; lead_days: number }>;
export type ProposeInput = Readonly<{ contractId: string; obligations: readonly ProposalInput[] }>;
export type ReplacementInput = Omit<ProposalInput, "clause_ref"> & Readonly<{ obligationId: string }>;
export type AmendInput = Readonly<{ contractId: string; path: string; clause_ref: string; effective_from: string; replacements: readonly ReplacementInput[] }>;
export type InForceInput = Readonly<{ contractId: string | null; at: string | null }>;
export type DueInput = Readonly<{ withinDays: number }>;
export type CompleteInput = Readonly<{ obligationId: string; at: string }>;

const invalid = (field: string): never => { throw failure("E_INPUT_SCHEMA", `The ${field} field is invalid.`, "Use the command's documented JSON input fields and formats."); };
const record = (raw: unknown): Readonly<Record<string, unknown>> => isRecord(raw) ? raw : invalid("input object");
const text = (raw: unknown, field: string): string => typeof raw === "string" && raw.trim().length > 0 ? raw : invalid(field);
const date = (raw: unknown, field: string): string => typeof raw === "string" && isCalendarDate(raw) ? raw : invalid(field);
const array = (raw: unknown, field: string): readonly unknown[] => Array.isArray(raw) ? raw : invalid(field);
const optionalDate = (raw: unknown, field: string): string | null => raw === undefined ? null : date(raw, field);
const contractId = (raw: unknown): string => typeof raw === "string" && isContractId(raw) ? raw : invalid("contractId");
const obligationId = (raw: unknown): string => typeof raw === "string" && isObligationId(raw) ? raw : invalid("obligationId");
const party = (raw: unknown): string => typeof raw === "string" && isParty(raw) ? raw : invalid("party");
const clauseRef = (raw: unknown): string => typeof raw === "string" && isClauseRef(raw) ? raw : invalid("clause_ref");
const days = (raw: unknown, field: string): number => typeof raw === "number" && Number.isSafeInteger(raw) && raw >= 0 && raw <= 365_000 ? raw : invalid(field);
const only = (raw: Readonly<Record<string, unknown>>, keys: readonly string[]): void => {
  for (const key of Object.keys(raw)) if (!keys.includes(key)) invalid(key);
};

function recurrence(raw: unknown): string | null {
  if (raw === undefined) return null;
  const value = text(raw, "recurrence");
  try { parseRecurrence(value, "2000-01-01"); }
  catch { throw failure("E_BAD_RECURRENCE", "The recurrence is not supported.", "Use once:YYYY-MM-DD, every:Nday|week|month|year[@YYYY-MM-DD], or rrule:FREQ=DAILY|WEEKLY|MONTHLY|YEARLY with optional INTERVAL and monthly BYMONTHDAY."); }
  return value;
}

function proposalFields(value: Readonly<Record<string, unknown>>): Omit<ProposalInput, "clause_ref"> {
  return { summary: text(value.summary, "summary"), party: party(value.party), quote: typeof value.quote === "string" ? value.quote : invalid("quote"), recurrence: recurrence(value.recurrence), lead_days: value.lead_days === undefined ? 0 : days(value.lead_days, "lead_days") };
}

export function parseIngest(raw: unknown): IngestInput {
  const value = record(raw);
  only(value, ["title", "party", "path", "effective_from", "effective_to"]);
  const from = optionalDate(value.effective_from, "effective_from");
  const to = optionalDate(value.effective_to, "effective_to");
  if (from !== null && to !== null && to <= from) invalid("effective_to");
  return { title: text(value.title, "title"), party: party(value.party), path: text(value.path, "path"), effective_from: from, effective_to: to };
}

export function parsePropose(raw: unknown): ProposeInput {
  const value = record(raw);
  only(value, ["contractId", "obligations"]);
  return { contractId: contractId(value.contractId), obligations: array(value.obligations, "obligations").map((item: unknown) => {
    const proposal = record(item);
    only(proposal, ["summary", "party", "clause_ref", "quote", "recurrence", "lead_days"]);
    return { ...proposalFields(proposal), clause_ref: clauseRef(proposal.clause_ref) };
  }) };
}

export function parseAmend(raw: unknown): AmendInput {
  const value = record(raw);
  only(value, ["contractId", "path", "clause_ref", "effective_from", "replacements"]);
  const replacements = value.replacements === undefined ? [] : array(value.replacements, "replacements");
  const parsed = replacements.map((item: unknown) => {
    const replacement = record(item);
    only(replacement, ["obligationId", "summary", "party", "quote", "recurrence", "lead_days"]);
    return { ...proposalFields(replacement), obligationId: obligationId(replacement.obligationId) };
  });
  if (new Set(parsed.map((item) => item.obligationId)).size !== parsed.length) invalid("replacements");
  return { contractId: contractId(value.contractId), path: text(value.path, "path"), clause_ref: clauseRef(value.clause_ref), effective_from: date(value.effective_from, "effective_from"), replacements: parsed };
}

export function parseInForce(raw: unknown): InForceInput {
  const value = record(raw);
  only(value, ["contractId", "at"]);
  return { contractId: value.contractId === undefined ? null : contractId(value.contractId), at: optionalDate(value.at, "at") };
}

export function parseDue(raw: unknown): DueInput {
  const value = record(raw);
  only(value, ["withinDays"]);
  return { withinDays: value.withinDays === undefined ? 0 : days(value.withinDays, "withinDays") };
}

export function parseComplete(raw: unknown): CompleteInput {
  const value = record(raw);
  only(value, ["obligationId", "at"]);
  return { obligationId: obligationId(value.obligationId), at: date(value.at, "at") };
}
