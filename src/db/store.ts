import type { Db } from "@ambitious/kit/db/open-db";
import { failure } from "@ambitious/kit/domain/failure";
import type { SQLInputValue, SQLOutputValue } from "node:sqlite";
import type { AmendInput, CompleteInput, DueInput, InForceInput, IngestInput, ProposeInput } from "../domain/inputs.ts";
import { completeVersion, dueItem, endVersion, proposeVersion, versionInForce } from "../domain/register.ts";
import type { ContractRecord, ObligationRecord, SourceText } from "../domain/register.ts";
import type { ObligationState } from "../domain/types.ts";

type Row = Record<string, SQLOutputValue>;
const corrupt = (): never => { throw failure("E_DB", "The register contains an invalid stored value.", "Restore a verified backup and run selfcheck."); };
const text = (row: Row, key: string): string => typeof row[key] === "string" ? row[key] : corrupt();
const nullableText = (row: Row, key: string): string | null => row[key] === null ? null : text(row, key);
const number = (row: Row, key: string): number => typeof row[key] === "number" && Number.isSafeInteger(row[key]) ? row[key] : corrupt();
const nullableNumber = (row: Row, key: string): number | null => row[key] === null ? null : number(row, key);
function state(raw: string): ObligationState {
  switch (raw) {
    case "proposed": case "rejected": case "verified": case "active": case "done": case "superseded": return raw;
    default: return corrupt();
  }
}
function contractRow(row: Row): ContractRecord {
  return { id: text(row, "id"), title: text(row, "title"), party: text(row, "party"), source_path: text(row, "source_path"), source_sha256: text(row, "source_sha256"), text_normalized: text(row, "text_normalized"), effective_from: text(row, "effective_from"), effective_to: nullableText(row, "effective_to") };
}
function obligationRow(row: Row): ObligationRecord {
  return {
    id: text(row, "id"), contract_id: text(row, "contract_id"), root_id: text(row, "root_id"), version: number(row, "version"), state: state(text(row, "state")),
    party: text(row, "party"), summary: text(row, "summary"), clause_ref: text(row, "clause_ref"), quote: text(row, "quote"),
    quote_start: nullableNumber(row, "quote_start"), quote_end: nullableNumber(row, "quote_end"), source_amendment_id: nullableText(row, "source_amendment_id"),
    recurrence: text(row, "recurrence"), anchor: text(row, "anchor"), lead_days: number(row, "lead_days"), next_due: nullableText(row, "next_due"),
    effective_from: text(row, "effective_from"), effective_to: nullableText(row, "effective_to"), ending_amendment_id: nullableText(row, "ending_amendment_id"), superseded_by: nullableText(row, "superseded_by"),
  };
}
function getContract(db: Db, id: string): ContractRecord {
  const row = db.prepare("SELECT * FROM contracts WHERE id = ?").get(id);
  if (row === undefined) throw failure("E_UNKNOWN_CONTRACT", "The contract was not found.", "Ingest its source and use the returned contractId.");
  return contractRow(row);
}
function nextId(db: Db, kind: "contract" | "obligation" | "amendment"): string {
  const tables = { contract: "contracts", obligation: "obligations", amendment: "amendments" };
  const row = db.prepare(`SELECT COUNT(*) AS count FROM ${tables[kind]}`).get();
  return `${kind}-${row === undefined ? corrupt() : number(row, "count") + 1}`;
}
function event(db: Db, id: string, from: ObligationState | null, to: ObligationState, at: string): void {
  db.prepare("INSERT INTO obligation_events(obligation_id,from_state,to_state,at,actor) VALUES(?,?,?,?,?)").run(id, from, to, at, "module");
}
function saveNew(db: Db, obligation: ObligationRecord, at: string): void {
  const entries = Object.entries(obligation);
  const values: SQLInputValue[] = entries.map((entry) => entry[1]);
  db.prepare(`INSERT INTO obligations(${entries.map((entry) => entry[0]).join(",")}) VALUES(${entries.map(() => "?").join(",")})`).run(...values);
  event(db, obligation.id, null, "proposed", at);
  event(db, obligation.id, "proposed", obligation.state === "rejected" ? "rejected" : "verified", at);
  if (obligation.state !== "rejected") event(db, obligation.id, "verified", "active", at);
}
function saveChanged(db: Db, before: ObligationRecord, after: ObligationRecord, at: string): void {
  db.prepare("UPDATE obligations SET state=?,next_due=?,effective_to=?,ending_amendment_id=?,superseded_by=? WHERE id=?")
    .run(after.state, after.next_due, after.effective_to, after.ending_amendment_id, after.superseded_by, after.id);
  event(db, after.id, before.state, after.state, at);
}

export function ingest(db: Db, input: IngestInput, source: SourceText, now: string) {
  const from = input.effective_from ?? now.slice(0, 10);
  if (input.effective_to !== null && input.effective_to <= from) throw failure("E_INPUT_SCHEMA", "The contract end date must be later than its start date.", "Provide effective_to after effective_from.");
  const existing = db.prepare("SELECT id FROM contracts WHERE title=? AND party=? AND source_sha256=? AND effective_from=? AND effective_to IS ?").get(input.title, input.party, source.sourceSha256, from, input.effective_to);
  const id = existing === undefined ? nextId(db, "contract") : text(existing, "id");
  if (existing === undefined) db.prepare("INSERT INTO contracts VALUES(?,?,?,?,?,?,?,?)").run(id, input.title, input.party, source.sourcePath, source.sourceSha256, source.textNormalized, from, input.effective_to);
  return { contractId: id, sha256: source.sourceSha256 };
}

export function propose(db: Db, input: ProposeInput, now: string) {
  const contract = getContract(db, input.contractId);
  const accepted: ObligationRecord[] = [];
  const rejected: { index: number; code: string; why: string }[] = [];
  for (const [index, proposal] of input.obligations.entries()) {
    if (db.prepare("SELECT id FROM amendments WHERE contract_id=? AND amends_clause_ref=? LIMIT 1").get(contract.id, proposal.clause_ref) !== undefined) {
      throw failure("E_TRANSITION", "This clause already has a recorded amendment.", "Restate the current obligation through amend with a replacement quote from the new source.");
    }
    const result = proposeVersion(nextId(db, "obligation"), contract, proposal, { sourcePath: contract.source_path, sourceSha256: contract.source_sha256, textNormalized: contract.text_normalized }, contract.effective_from, now);
    saveNew(db, result.obligation, now);
    if (result.rejection === null) accepted.push(result.obligation);
    else rejected.push({ index, ...result.rejection });
  }
  return { accepted, rejected };
}

export function amend(db: Db, input: AmendInput, source: SourceText, now: string) {
  const contract = getContract(db, input.contractId);
  const affected = db.prepare("SELECT * FROM obligations WHERE contract_id=? AND clause_ref=? AND state='active' AND ending_amendment_id IS NULL ORDER BY id").all(contract.id, input.clause_ref).map(obligationRow);
  if (affected.length === 0) throw failure("E_TRANSITION", "The clause has no active version to amend.", "Choose the clause_ref of an active obligation.");
  if (input.replacements.some((item) => !affected.some((obligation) => obligation.id === item.obligationId))) throw failure("E_UNKNOWN_OBLIGATION", "A replacement does not identify an active obligation in this clause.", "Use an obligationId from in-force for this contract and clause.");
  const amendmentId = nextId(db, "amendment");
  db.prepare("INSERT INTO amendments VALUES(?,?,?,?,?,?,?)").run(amendmentId, contract.id, input.clause_ref, source.sourcePath, source.sourceSha256, source.textNormalized, input.effective_from);
  const superseded: ObligationRecord[] = [];
  const accepted: ObligationRecord[] = [];
  for (const obligation of affected) {
    const replacement = input.replacements.find((item) => item.obligationId === obligation.id);
    const result = replacement === undefined ? null : proposeVersion(nextId(db, "obligation"), contract, { ...replacement, clause_ref: input.clause_ref }, source, input.effective_from, now, obligation, amendmentId);
    if (result !== null && result.rejection !== null) throw failure(result.rejection.code, result.rejection.why, "Use a quote that occurs exactly once in the amendment source.");
    const ended = endVersion(obligation, input.effective_from, amendmentId, result?.obligation.id ?? null);
    saveChanged(db, obligation, ended, now);
    superseded.push(ended);
    if (result !== null) { saveNew(db, result.obligation, now); accepted.push(result.obligation); }
  }
  return { amendmentId, superseded, accepted };
}

export function inForce(db: Db, input: InForceInput, now: string) {
  if (input.contractId !== null) getContract(db, input.contractId);
  const rows = input.contractId === null
    ? db.prepare("SELECT * FROM obligations ORDER BY root_id,version").all()
    : db.prepare("SELECT * FROM obligations WHERE contract_id=? ORDER BY root_id,version").all(input.contractId);
  return { obligations: rows.map(obligationRow).filter((obligation) => versionInForce(obligation, input.at ?? now.slice(0, 10))) };
}

export function due(db: Db, input: DueInput, now: string) {
  const items = db.prepare("SELECT o.*,COALESCE(a.text_normalized,c.text_normalized) AS source_text FROM obligations o JOIN contracts c ON c.id=o.contract_id LEFT JOIN amendments a ON a.id=o.source_amendment_id WHERE o.state='active' ORDER BY o.next_due,o.id").all()
    .flatMap((row) => {
      const item = dueItem(obligationRow(row), text(row, "source_text"), now, input.withinDays);
      return item === null ? [] : [item];
    });
  return { items };
}

export function complete(db: Db, input: CompleteInput, _now: string) {
  const row = db.prepare("SELECT * FROM obligations WHERE id=?").get(input.obligationId);
  if (row === undefined) throw failure("E_UNKNOWN_OBLIGATION", "The obligation was not found.", "Use an obligationId returned by propose, in-force, or due.");
  const before = obligationRow(row);
  const obligation = completeVersion(before);
  saveChanged(db, before, obligation, `${input.at}T00:00:00.000Z`);
  return { obligation };
}
