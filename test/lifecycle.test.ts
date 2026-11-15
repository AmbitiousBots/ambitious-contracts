import assert from "node:assert/strict";
import { test } from "node:test";
import * as fc from "fast-check";
import { completeVersion, dueItem, endVersion, proposeVersion, versionInForce } from "../src/domain/register.ts";
import type { ContractRecord, ObligationRecord } from "../src/domain/register.ts";
import { addDays } from "../src/domain/recurrence.ts";
import { parseAmend, parseComplete, parseDue, parseInForce, parseIngest, parsePropose } from "../src/domain/inputs.ts";

const start = "2026-01-01";
const now = `${start}T00:00:00.000Z`;
const source = { sourcePath: "contract.txt", sourceSha256: "a".repeat(64), textNormalized: "Deliver one report." };
const contract: ContractRecord = { id: "contract-1", title: "Reporting", party: "Provider", source_path: source.sourcePath, source_sha256: source.sourceSha256, text_normalized: source.textNormalized, effective_from: start, effective_to: null };
const proposal = { summary: "Deliver report", party: "Provider", clause_ref: "1", quote: source.textNormalized, recurrence: "every:1day", lead_days: 0 };

test("generated amendment histories have exactly one version in force on every covered date", () => {
  fc.assert(fc.property(fc.array(fc.integer({ min: 1, max: 20 }), { minLength: 1, maxLength: 12 }), (gaps) => {
    let latest = proposeVersion("obligation-1", contract, proposal, source, start, now).obligation;
    const versions: ObligationRecord[] = [];
    let offset = 0;
    for (const [index, gap] of gaps.entries()) {
      offset += gap;
      const from = addDays(start, offset);
      const successorId = `obligation-${index + 2}`;
      const amendmentId = `amendment-${index + 1}`;
      const ended = endVersion(latest, from, amendmentId, successorId);
      versions.push(ended);
      latest = proposeVersion(successorId, contract, proposal, source, from, now, latest, amendmentId).obligation;
    }
    versions.push(latest);
    for (let day = -1; day <= offset + 1; day += 1) {
      const date = addDays(start, day);
      assert.equal(versions.filter((item) => versionInForce(item, date)).length, day < 0 ? 0 : 1);
    }
    for (const version of versions) {
      let active = version;
      while (active.state === "active" && active.next_due !== null && active.next_due < addDays(start, offset + 2)) {
        const item = dueItem(active, source.textNormalized, now, offset + 2);
        assert.ok(item);
        assert.equal(versionInForce(active, item.due), true);
        assert.equal(item.suggestedTask.idem_key, `contract:${active.id}:${item.due}`);
        active = completeVersion(active);
      }
      if (version.effective_to !== null) assert.equal(active.state, "superseded");
    }
  }), { seed: 90512, numRuns: 500 });
});

test("a rejected quote never produces due work", () => {
  const rejected = proposeVersion("obligation-1", contract, { ...proposal, quote: "Deliver two reports." }, source, start, now);
  assert.equal(rejected.rejection?.code, "E_QUOTE_NOT_LITERAL");
  assert.equal(dueItem(rejected.obligation, source.textNormalized, now, 30), null);
});

test("an amendment cannot rewrite or overlap the current version's start", () => {
  const active = proposeVersion("obligation-1", contract, proposal, source, start, now).obligation;
  assert.throws(() => endVersion(active, start, "amendment-1", null), /after the current version starts/);
  assert.throws(() => endVersion(active, "2025-12-31", "amendment-1", null), /after the current version starts/);
});

test("completion consumes exactly one occurrence", () => {
  const active = proposeVersion("obligation-1", contract, proposal, source, start, now).obligation;
  assert.equal(completeVersion(active).next_due, "2026-01-02");
});

test("a version can finish before its next unbounded occurrence exceeds the calendar", () => {
  const bounded = { ...contract, effective_to: "2027-01-01" };
  const active = proposeVersion("obligation-1", bounded, { ...proposal, recurrence: "every:10000year" }, source, start, now).obligation;
  assert.equal(completeVersion(active).state, "done");
  assert.equal(completeVersion(active).next_due, null);
  const amended = endVersion(active, "2026-07-01", "amendment-1", null);
  assert.equal(completeVersion(amended).state, "superseded");
  const lastYear = { ...contract, effective_from: "9999-01-01", effective_to: "9999-12-31" };
  const final = proposeVersion("obligation-1", lastYear, { ...proposal, recurrence: "every:1year" }, source, "9999-01-01", "9999-01-01T00:00:00.000Z").obligation;
  assert.equal(completeVersion(final).state, "done");
});

test("lead time includes upcoming work while retaining overdue items", () => {
  const active = proposeVersion("obligation-1", contract, { ...proposal, recurrence: "once:2026-02-01", lead_days: 7 }, source, start, now).obligation;
  assert.equal(dueItem(active, source.textNormalized, "2026-01-24T00:00:00.000Z", 0), null);
  assert.ok(dueItem(active, source.textNormalized, "2026-01-25T00:00:00.000Z", 0));
  assert.ok(dueItem(active, source.textNormalized, "2026-03-01T00:00:00.000Z", 0));
});

test("input parsers reject invalid dates, duplicate replacements, and unknown fields before persistence", () => {
  assert.throws(() => parseIngest({ title: "Terms", party: "Provider", path: "contract.txt", effective_from: "2026-02-30" }));
  assert.throws(() => parseIngest({ title: "Terms", party: "Provider", path: "contract.txt", effective_from: "2026-02-01", effective_to: "2026-01-31" }));
  assert.throws(() => parseInForce({ contractId: "contract-1", at: "today" }));
  assert.throws(() => parseComplete({ obligationId: "obligation-1", at: "2026-02-30" }));
  assert.throws(() => parseDue({ withinDays: -1 }));
  assert.throws(() => parseDue({ withinDays: 1, surprise: true }));
  assert.throws(() => parsePropose({ contractId: "contract-1", obligations: [{ ...proposal, recurrence: "every:0day" }] }));
  const replacement = { obligationId: "obligation-1", summary: "Report", party: "Provider", quote: "Text" };
  assert.throws(() => parseAmend({ contractId: "contract-1", path: "amendment.txt", clause_ref: "1", effective_from: "2026-02-01", replacements: [replacement, replacement] }));
});
