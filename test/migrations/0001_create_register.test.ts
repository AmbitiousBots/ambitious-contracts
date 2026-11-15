import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { openDb, readUserVersion } from "@ambitious/kit/db/open-db";
import type { Db } from "@ambitious/kit/db/open-db";
import { migrate } from "@ambitious/kit/db/migrate";
import { loadMigrations } from "@ambitious/kit/db/load-migrations";
import { parseAmend, parseComplete, parseIngest, parsePropose } from "../../src/domain/inputs.ts";
import { amend, complete, due, inForce, ingest, propose } from "../../src/db/store.ts";

const now = "2026-01-01T00:00:00.000Z";
const source = { sourcePath: "contract.txt", sourceSha256: "a".repeat(64), textNormalized: "Send a report each month." };
const replacementSource = { sourcePath: "amendment.txt", sourceSha256: "b".repeat(64), textNormalized: "Deliver the revised report monthly." };
const migrations = loadMigrations(join(import.meta.dirname, "..", "..", "migrations"));

function withDb(run: (db: Db, file: string) => void): void {
  const home = mkdtempSync(join(tmpdir(), "contracts-migration-"));
  const file = join(home, "contracts.sqlite");
  const db = openDb(file, { readonly: false });
  try { run(db, file); } finally { db.close(); rmSync(home, { recursive: true, force: true }); }
}
function transaction<T>(db: Db, run: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try { const result = run(); db.exec("COMMIT"); return result; }
  catch (error) { db.exec("ROLLBACK"); throw error; }
}
function fixture(db: Db) {
  migrate(db, migrations);
  const contract = transaction(db, () => ingest(db, parseIngest({ title: "Reporting agreement", party: "Provider", path: "contract.txt" }), source, now));
  const proposed = transaction(db, () => propose(db, parsePropose({ contractId: contract.contractId, obligations: [{ summary: "Send report", party: "Provider", clause_ref: "1", quote: source.textNormalized, recurrence: "every:1month@2026-01-01" }] }), now));
  const obligation = proposed.accepted[0];
  assert.ok(obligation);
  return { contract, obligation };
}

test("initial migration creates the register and replaying migrations preserves its rows", () => withDb((db, file) => {
  assert.equal(readUserVersion(db), 0);
  const { contract, obligation } = fixture(db);
  assert.equal(readUserVersion(db), 1);
  assert.equal(db.prepare("PRAGMA journal_mode").get()?.journal_mode, "wal");
  assert.equal(db.prepare("PRAGMA foreign_keys").get()?.foreign_keys, 1);
  assert.deepEqual(migrate(db, migrations), []);
  assert.equal(inForce(db, { contractId: contract.contractId, at: "2026-01-01" }, now).obligations[0]?.id, obligation.id);
  assert.deepEqual(db.prepare("SELECT from_state,to_state FROM obligation_events ORDER BY seq").all().map((row) => [row.from_state, row.to_state]), [[null, "proposed"], ["proposed", "verified"], ["verified", "active"]]);
  assert.throws(() => db.exec("DELETE FROM obligation_events"), /cannot be deleted/);
  assert.throws(() => db.exec("UPDATE obligation_events SET actor='changed'"), /cannot be changed/);
  const readOnly = openDb(file, { readonly: true });
  try {
    assert.equal(due(readOnly, { withinDays: 0 }, now).items.length, 1);
    assert.throws(() => readOnly.exec("INSERT INTO contracts(id) VALUES('unwanted')"), /readonly/);
  } finally { readOnly.close(); }
}));

test("amendment keeps an owed occurrence and completion stops at the replacement boundary", () => withDb((db) => {
  const { contract, obligation } = fixture(db);
  const changed = transaction(db, () => amend(db, parseAmend({ contractId: contract.contractId, path: "amendment.txt", clause_ref: "1", effective_from: "2026-02-01", replacements: [{ obligationId: obligation.id, summary: "Deliver revised report", party: "Provider", quote: replacementSource.textNormalized, recurrence: "every:1month" }] }), replacementSource, now));
  assert.equal(changed.superseded[0]?.state, "active");
  assert.equal(changed.accepted[0]?.version, 2);
  assert.equal(inForce(db, { contractId: contract.contractId, at: "2026-01-31" }, now).obligations[0]?.id, obligation.id);
  assert.equal(inForce(db, { contractId: contract.contractId, at: "2026-02-01" }, now).obligations[0]?.id, changed.accepted[0]?.id);
  assert.equal(due(db, { withinDays: 31 }, now).items.length, 2);
  const finished = transaction(db, () => complete(db, parseComplete({ obligationId: obligation.id, at: "2026-01-01" }), now));
  assert.equal(finished.obligation.state, "superseded");
  assert.equal(finished.obligation.next_due, null);
  assert.deepEqual(due(db, { withinDays: 31 }, now).items.map((item) => item.obligation.id), [changed.accepted[0]?.id]);
}));

test("invalid replacement leaves the source, events and version windows unchanged", () => withDb((db) => {
  const { contract, obligation } = fixture(db);
  const events = db.prepare("SELECT COUNT(*) AS count FROM obligation_events").get()?.count;
  assert.throws(() => transaction(db, () => amend(db, parseAmend({ contractId: contract.contractId, path: "amendment.txt", clause_ref: "1", effective_from: "2026-02-01", replacements: [{ obligationId: obligation.id, summary: "Deliver revised report", party: "Provider", quote: "Invented sentence." }] }), replacementSource, now)), /exactly match/);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM amendments").get()?.count, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM obligation_events").get()?.count, events);
  assert.equal(inForce(db, { contractId: contract.contractId, at: "2026-02-01" }, now).obligations[0]?.id, obligation.id);
}));

test("a failed multi-obligation amendment rolls back earlier replacements", () => withDb((db) => {
  const { contract, obligation } = fixture(db);
  const second = transaction(db, () => propose(db, parsePropose({ contractId: contract.contractId, obligations: [{ summary: "Second report", party: "Provider", clause_ref: "1", quote: source.textNormalized, recurrence: "every:1month" }] }), now)).accepted[0];
  assert.ok(second);
  assert.throws(() => transaction(db, () => amend(db, parseAmend({ contractId: contract.contractId, path: "amendment.txt", clause_ref: "1", effective_from: "2026-02-01", replacements: [{ obligationId: obligation.id, summary: "Changed", party: "Provider", quote: replacementSource.textNormalized }, { obligationId: second.id, summary: "Invalid", party: "Provider", quote: "Absent text." }] }), replacementSource, now)), /exactly match/);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM amendments").get()?.count, 0);
  assert.deepEqual(inForce(db, { contractId: contract.contractId, at: "2026-02-01" }, now).obligations.map((row) => row.version), [1, 1]);
}));

test("amend without replacement removes the clause after its effective date", () => withDb((db) => {
  const { contract, obligation } = fixture(db);
  transaction(db, () => complete(db, parseComplete({ obligationId: obligation.id, at: "2026-01-01" }), now));
  const changed = transaction(db, () => amend(db, parseAmend({ contractId: contract.contractId, path: "amendment.txt", clause_ref: "1", effective_from: "2026-02-01" }), replacementSource, now));
  assert.equal(changed.superseded[0]?.state, "superseded");
  assert.equal(changed.accepted.length, 0);
  assert.equal(inForce(db, { contractId: contract.contractId, at: "2026-01-31" }, now).obligations.length, 1);
  assert.equal(inForce(db, { contractId: contract.contractId, at: "2026-02-01" }, now).obligations.length, 0);
  assert.equal(due(db, { withinDays: 100 }, now).items.length, 0);
}));


test("early and late completion each consume exactly one occurrence", () => withDb((db) => {
  const { obligation } = fixture(db);
  const early = transaction(db, () => complete(db, parseComplete({ obligationId: obligation.id, at: "2025-12-31" }), now));
  assert.equal(early.obligation.next_due, "2026-02-01");
  const late = transaction(db, () => complete(db, parseComplete({ obligationId: obligation.id, at: "2026-12-31" }), now));
  assert.equal(late.obligation.next_due, "2026-03-01");
  assert.equal(db.prepare("SELECT at FROM obligation_events ORDER BY seq DESC LIMIT 1").get()?.at, "2026-12-31T00:00:00.000Z");
}));
