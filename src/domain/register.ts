import { failure } from "@ambitious/kit/domain/failure";
import type { ProposalInput } from "./inputs.ts";
import { addDays, firstDue, nextDue, parseRecurrence } from "./recurrence.ts";
import { verifyQuote } from "./quotes.ts";
import type { ObligationState, QuoteRejection } from "./types.ts";

export type SourceText = Readonly<{ sourcePath: string; sourceSha256: string; textNormalized: string }>;
export type ContractRecord = Readonly<{ id: string; title: string; party: string; source_path: string; source_sha256: string; text_normalized: string; effective_from: string; effective_to: string | null }>;
export type ObligationRecord = Readonly<{
  id: string; contract_id: string; root_id: string; version: number; state: ObligationState;
  party: string; summary: string; clause_ref: string; quote: string;
  quote_start: number | null; quote_end: number | null; source_amendment_id: string | null;
  recurrence: string; anchor: string; lead_days: number; next_due: string | null;
  effective_from: string; effective_to: string | null; ending_amendment_id: string | null; superseded_by: string | null;
}>;
export type ProposalResult = Readonly<{ obligation: ObligationRecord; rejection: QuoteRejection | null }>;

export function schedule(recurrence: string, anchor: string, from: string, to: string | null): string {
  try {
    const rule = parseRecurrence(recurrence, anchor);
    let due = firstDue(rule);
    if (due < from) {
      const advanced = nextDue(rule, addDays(from, -1));
      if (advanced === null) throw new Error("The one-time due date precedes this version.");
      due = advanced;
    }
    if (to !== null && due >= to) throw new Error("No due date falls inside this version's effective dates.");
    return due;
  } catch {
    throw failure("E_BAD_RECURRENCE", "The recurrence has no supported due date inside the effective dates.", "Choose a recurrence that starts on or after effective_from and before effective_to.");
  }
}

export function proposeVersion(id: string, contract: ContractRecord, proposal: ProposalInput, source: SourceText, from: string, now: string, predecessor: ObligationRecord | null = null, amendmentId: string | null = null): ProposalResult {
  const quote = verifyQuote(source.textNormalized, proposal.quote);
  const anchor = from;
  const recurrence = proposal.recurrence ?? `once:${now.slice(0, 10) < from ? from : now.slice(0, 10)}`;
  const obligation: ObligationRecord = {
    id, contract_id: contract.id, root_id: predecessor?.root_id ?? id, version: predecessor === null ? 1 : predecessor.version + 1,
    state: quote.ok ? "active" : "rejected", party: proposal.party, summary: proposal.summary, clause_ref: proposal.clause_ref,
    quote: proposal.quote, quote_start: quote.ok ? quote.start : null, quote_end: quote.ok ? quote.end : null,
    source_amendment_id: amendmentId, recurrence, anchor, lead_days: proposal.lead_days,
    next_due: quote.ok ? schedule(recurrence, anchor, from, contract.effective_to) : null,
    effective_from: from, effective_to: contract.effective_to, ending_amendment_id: null, superseded_by: null,
  };
  return { obligation, rejection: quote.ok ? null : { code: quote.code, why: quote.why } };
}

export function versionInForce(obligation: ObligationRecord, date: string): boolean {
  return obligation.state !== "proposed" && obligation.state !== "rejected" && obligation.effective_from <= date && (obligation.effective_to === null || date < obligation.effective_to);
}

export function endVersion(obligation: ObligationRecord, effectiveFrom: string, amendmentId: string, successorId: string | null): ObligationRecord {
  if (obligation.state !== "active" || obligation.next_due === null || obligation.ending_amendment_id !== null) {
    throw failure("E_TRANSITION", "Only the latest active version can be amended.", "Choose a currently active obligation without a recorded amendment.");
  }
  if (effectiveFrom <= obligation.effective_from || (obligation.effective_to !== null && effectiveFrom >= obligation.effective_to)) {
    throw failure("E_AMENDMENT_NOT_AFTER_START", "The amendment date must fall after the current version starts and before it ends.", "Choose an effective_from date strictly inside the current version's effective dates.");
  }
  const hasBacklog = obligation.next_due < effectiveFrom;
  return { ...obligation, effective_to: effectiveFrom, ending_amendment_id: amendmentId, superseded_by: successorId, state: hasBacklog ? "active" : "superseded", next_due: hasBacklog ? obligation.next_due : null };
}

export function completeVersion(obligation: ObligationRecord): ObligationRecord {
  if (obligation.state !== "active" || obligation.next_due === null) {
    throw failure("E_TRANSITION", "This obligation has no active occurrence to complete.", "Choose an active obligation from due.");
  }
  let following: string | null;
  let recurring: boolean;
  try {
    const rule = parseRecurrence(obligation.recurrence, obligation.anchor);
    recurring = rule.kind !== "once";
    following = nextDue(rule, obligation.next_due, obligation.effective_to);
  }
  catch { throw failure("E_BAD_RECURRENCE", "The next occurrence falls outside the supported calendar.", "Amend the obligation with an end date before completing its final supported occurrence."); }
  const terminal = recurring && obligation.ending_amendment_id !== null ? "superseded" : "done";
  return { ...obligation, state: following === null ? terminal : "active", next_due: following };
}

export function dueItem(obligation: ObligationRecord, text: string, now: string, withinDays: number) {
  if (obligation.state !== "active" || obligation.next_due === null) return null;
  const quote = verifyQuote(text, obligation.quote);
  if (!quote.ok || quote.start !== obligation.quote_start || quote.end !== obligation.quote_end || !versionInForce(obligation, obligation.next_due)) {
    throw failure("E_DB", "An active obligation no longer matches its source or effective dates.", "Restore the register from a verified backup and run selfcheck.");
  }
  let windowEnd: string;
  try { windowEnd = addDays(now.slice(0, 10), withinDays + obligation.lead_days); }
  catch { throw failure("E_INPUT_SCHEMA", "The due window falls outside the supported calendar.", "Use fewer withinDays or lead_days."); }
  if (obligation.next_due > windowEnd) return null;
  return {
    obligation,
    due: obligation.next_due,
    suggestedTask: {
      title: obligation.summary, list: "contracts", due: obligation.next_due, labels: [`contract:${obligation.contract_id}`],
      done_when: obligation.quote, idem_key: `contract:${obligation.id}:${obligation.next_due}`,
    },
  };
}
