import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

type Row = Record<string, unknown>;

const root = join(import.meta.dirname, "..");
const binary = join(root, "dist", "ambitious-contracts.mjs");
const source = join(root, "test", "fixtures", "contract.txt");
const amendment = join(root, "test", "fixtures", "amendment.txt");
const quote = "The provider delivers a monthly report.";

function row(value: unknown): Row {
  assert(value !== null && typeof value === "object" && !Array.isArray(value));
  return Object.fromEntries(Object.entries(value));
}

function rows(value: unknown): Row[] {
  assert(Array.isArray(value));
  return value.map(row);
}

function text(value: unknown): string {
  assert.equal(typeof value, "string");
  if (typeof value !== "string") throw new Error("Expected text.");
  return value;
}

function first(value: unknown): Row {
  const [item] = rows(value);
  assert(item !== undefined);
  return item;
}

function bench() {
  const home = mkdtempSync(join(tmpdir(), "contracts-cli-"));
  const run = (command: string, input?: unknown, options: { now?: string; flags?: string[]; exit?: number } = {}) => {
    const result = spawnSync(process.execPath, [binary, command, "--now", options.now ?? "2026-01-01T00:00:00Z", "--seed", "7", ...(options.flags ?? [])], {
      env: { ...process.env, AMBITIOUS_HOME: home },
      encoding: "utf8",
      input: input === undefined ? "" : JSON.stringify(input),
      timeout: 60_000,
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status, options.exit ?? 0, `${command}: ${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /^[^\n]+\n$/u);
    const envelope = row(JSON.parse(result.stdout));
    assert.equal(envelope.ok, (options.exit ?? 0) === 0);
    assert.deepEqual(Object.keys(envelope).sort(), ["command", "data", "errors", "meta", "module", "ok", "schemaVersion"]);
    assert.equal(envelope.module, "contracts");
    return { envelope, data: row(envelope.data), stdout: result.stdout };
  };
  const ingest = () => text(run("ingest", { title: "Service agreement", party: "provider", path: source }).data.contractId);
  const propose = (contractId: string, recurrence = "every:1month@2026-01-31", lead_days = 0) => first(run("propose", {
    contractId,
    obligations: [{ summary: "Deliver report", party: "provider", clause_ref: "report", quote, recurrence, lead_days }],
  }).data.accepted);
  return { home, run, ingest, propose, close: () => rmSync(home, { recursive: true, force: true }) };
}

test("discovery: commands describe every input and database access mode", () => {
  const b = bench();
  try {
    const commands = rows(b.run("commands").data.commands);
    assert.deepEqual(commands.map((command) => command.name).sort(), ["amend", "commands", "complete", "due", "in-force", "ingest", "propose", "selfcheck"]);
    for (const name of ["due", "in-force"]) assert.equal(commands.find((command) => command.name === name)?.access, "read");
    assert.equal(existsSync(join(b.home, "contracts", "contracts.sqlite")), false);
  } finally { b.close(); }
});

test("selfcheck: initializes and reopens the database with a verifiable binary checksum", () => {
  const b = bench();
  try {
    const initial = b.run("selfcheck").data;
    assert.deepEqual(initial.problems, []);
    assert.equal(row(initial.db).integrityCheck, "ok");
    assert.equal(row(initial.db).userVersion, 1);
    assert.equal(row(initial.binary).sha256, createHash("sha256").update(readFileSync(binary)).digest("hex"));
    assert.equal(existsSync(join(b.home, "contracts", "contracts.sqlite")), true);
    const repeated = b.run("selfcheck").data;
    assert.deepEqual(row(repeated.db).migrationsApplied, []);
    assert.deepEqual(repeated.problems, []);
  } finally { b.close(); }
});

test("ingest: keeps source checksum and normalizes text before literal quote matching", () => {
  const b = bench();
  try {
    const result = b.run("ingest", { title: "Service agreement", party: "provider", path: source }).data;
    assert.equal(result.sha256, createHash("sha256").update(readFileSync(source)).digest("hex"));
    const contractId = text(result.contractId);
    const accepted = first(b.run("propose", { contractId, obligations: [{ summary: "Keep records", party: "provider", clause_ref: "records", quote: "Café records remain available.", recurrence: "once:2026-02-01" }] }).data.accepted);
    const normalized = readFileSync(source, "utf8").normalize("NFC").replace(/\s+/gu, " ").trim();
    assert.equal(typeof accepted.quote_start, "number");
    assert.equal(typeof accepted.quote_end, "number");
    if (typeof accepted.quote_start !== "number" || typeof accepted.quote_end !== "number") throw new Error("Expected quote offsets.");
    assert.equal(normalized.slice(accepted.quote_start, accepted.quote_end), accepted.quote);
    assert.equal(first(b.run("in-force", { contractId, at: "2026-02-01" }).data.obligations).id, accepted.id);
  } finally { b.close(); }
});

test("quotes: accepts unique literal spans and rejects paraphrases and ambiguous spans", () => {
  const b = bench();
  try {
    const contractId = b.ingest();
    const obligations = [quote, "The provider sends a monthly report.", "Notice is required."].map((candidate) => ({ summary: "Deliver report", party: "provider", clause_ref: "report", quote: candidate, recurrence: "once:2026-01-31" }));
    const result = b.run("propose", { contractId, obligations }).data;
    assert.equal(rows(result.accepted).length, 1);
    assert.deepEqual(rows(result.rejected).map(({ index, code }) => ({ index, code })), [{ index: 1, code: "E_QUOTE_NOT_LITERAL" }, { index: 2, code: "E_AMBIGUOUS_QUOTE" }]);
    assert.equal(rows(b.run("due", { withinDays: 31 }).data.items).length, 1);
    const fixture = row(JSON.parse(readFileSync(join(root, "test", "fixtures", "paraphrased-quote.json"), "utf8")));
    const inputFile = join(b.home, "proposal.json");
    writeFileSync(inputFile, JSON.stringify({ ...fixture, contractId }));
    assert.equal(first(b.run("propose", undefined, { flags: ["--in", inputFile] }).data.rejected).code, "E_QUOTE_NOT_LITERAL");
  } finally { b.close(); }
});

test("due: lead time and overdue work produce repeatable task add payloads", () => {
  const b = bench();
  try {
    const contractId = b.ingest();
    const obligation = b.propose(contractId, "every:1month@2026-01-31", 7);
    assert.deepEqual(b.run("due", { withinDays: 0 }, { now: "2026-01-23T00:00:00Z" }).data.items, []);
    const due = first(b.run("due", { withinDays: 0 }, { now: "2026-01-24T00:00:00Z" }).data.items);
    assert.equal(due.due, "2026-01-31");
    assert.equal(row(due.obligation).id, obligation.id);
    assert.deepEqual(row(due.suggestedTask), {
      title: "Deliver report", list: "contracts", due: "2026-01-31", labels: [`contract:${contractId}`], done_when: quote, idem_key: `contract:${text(obligation.id)}:2026-01-31`,
    });
    const options = { now: "2026-02-10T00:00:00Z" };
    assert.equal(b.run("due", { withinDays: 0 }, options).stdout, b.run("due", { withinDays: 0 }, options).stdout);
    assert.equal(first(b.run("due", { withinDays: 0 }, options).data.items).due, "2026-01-31");
  } finally { b.close(); }
});

test("complete: advances one occurrence without losing month ends and finishes once-only work", () => {
  const b = bench();
  try {
    const contractId = b.ingest();
    const obligation = b.propose(contractId);
    const obligationId = text(obligation.id);
    assert.equal(row(b.run("complete", { obligationId, at: "2026-01-31" }).data.obligation).next_due, "2026-02-28");
    assert.equal(row(b.run("complete", { obligationId, at: "2026-02-28" }).data.obligation).next_due, "2026-03-31");
    const once = b.propose(contractId, "once:2026-02-01");
    const done = row(b.run("complete", { obligationId: text(once.id), at: "2026-02-01" }).data.obligation);
    assert.equal(done.state, "done");
    assert.equal(done.next_due, null);
    const items = rows(b.run("due", { withinDays: 400 }).data.items);
    assert.equal(items.some((item) => row(item.obligation).id === once.id), false);
  } finally { b.close(); }
});

test("complete: lead-time work can finish early without shifting its next scheduled occurrence", () => {
  const b = bench();
  try {
    const contractId = b.ingest();
    const obligation = b.propose(contractId, "every:1month@2026-01-31", 7);
    assert.equal(rows(b.run("due", { withinDays: 0 }, { now: "2026-01-24T00:00:00Z" }).data.items).length, 1);
    const completed = row(b.run("complete", { obligationId: text(obligation.id), at: "2026-01-24" }).data.obligation);
    assert.equal(completed.next_due, "2026-02-28");
    assert.deepEqual(b.run("due", { withinDays: 0 }, { now: "2026-01-24T00:00:00Z" }).data.items, []);
  } finally { b.close(); }
});

test("ingest: effective dates bound version history and recurring due work", () => {
  const b = bench();
  try {
    const contractId = text(b.run("ingest", {
      title: "Limited agreement", party: "provider", path: source, effective_from: "2026-02-15", effective_to: "2026-03-15",
    }).data.contractId);
    const obligation = b.propose(contractId, "every:1month@2026-01-31");
    assert.equal(obligation.next_due, "2026-02-28");
    assert.deepEqual(b.run("in-force", { contractId, at: "2026-02-14" }).data.obligations, []);
    assert.equal(rows(b.run("in-force", { contractId, at: "2026-02-15" }).data.obligations).length, 1);
    assert.deepEqual(b.run("in-force", { contractId, at: "2026-03-15" }).data.obligations, []);
    const completed = row(b.run("complete", { obligationId: text(obligation.id), at: "2026-02-28" }).data.obligation);
    assert.equal(completed.state, "done");
    assert.equal(completed.next_due, null);
    assert.deepEqual(b.run("due", { withinDays: 365 }).data.items, []);
  } finally { b.close(); }
});

test("amendments: replacement has one version in force and preserves only earlier backlog", () => {
  const b = bench();
  try {
    const contractId = b.ingest();
    const old = b.propose(contractId);
    const changed = b.run("amend", {
      contractId, path: amendment, clause_ref: "report", effective_from: "2026-02-15",
      replacements: [{ obligationId: text(old.id), summary: "Deliver revised report", party: "provider", quote: "The provider delivers a revised monthly report.", recurrence: "every:1month@2026-01-31" }],
    }).data;
    const replacement = first(changed.accepted);
    assert.equal(replacement.version, 2);
    assert.equal(replacement.root_id, old.root_id);
    assert.equal(first(b.run("in-force", { contractId, at: "2026-02-14" }).data.obligations).id, old.id);
    const atBoundary = rows(b.run("in-force", { contractId, at: "2026-02-15" }).data.obligations);
    assert.equal(atBoundary.length, 1);
    assert.equal(atBoundary[0]?.id, replacement.id);
    const ended = row(b.run("complete", { obligationId: text(old.id), at: "2026-03-01" }).data.obligation);
    assert.equal(ended.state, "superseded");
    assert.equal(ended.next_due, null);
    const due = rows(b.run("due", { withinDays: 90 }).data.items);
    assert.equal(due.some((item) => row(item.obligation).id === old.id), false);
    assert.equal(due.some((item) => row(item.obligation).id === replacement.id), true);
  } finally { b.close(); }
});

test("amendments: removal ends the clause and invalid replacements leave the register unchanged", () => {
  const b = bench();
  try {
    const contractId = b.ingest();
    const old = b.propose(contractId);
    const input = { contractId, path: amendment, clause_ref: "report", effective_from: "2026-01-15" };
    const rejected = b.run("amend", { ...input, replacements: [{ obligationId: text(old.id), summary: "Deliver report", party: "provider", quote: "An invented obligation." }] }, { exit: 1 });
    assert.equal(first(rejected.envelope.errors).code, "E_QUOTE_NOT_LITERAL");
    assert.equal(first(b.run("in-force", { contractId, at: "2026-02-01" }).data.obligations).id, old.id);
    b.run("amend", input);
    assert.deepEqual(b.run("in-force", { contractId, at: "2026-01-15" }).data.obligations, []);
    assert.deepEqual(b.run("due", { withinDays: 90 }).data.items, []);
  } finally { b.close(); }
});

test("readonly: analysis commands leave stored data unchanged and repeat byte for byte", () => {
  const b = bench();
  try {
    const contractId = b.ingest();
    b.propose(contractId);
    const path = join(b.home, "contracts", "contracts.sqlite");
    const before = readFileSync(path);
    const input = { contractId, at: "2026-01-01" };
    assert.equal(b.run("in-force", input).stdout, b.run("in-force", input).stdout);
    assert.deepEqual(b.run("in-force", {}).data.obligations, b.run("in-force", input).data.obligations);
    assert.equal(b.run("due", {}).stdout, b.run("due", { withinDays: 0 }).stdout);
    assert.equal(b.run("due", { withinDays: 90 }).stdout, b.run("due", { withinDays: 90 }).stdout);
    assert.deepEqual(readFileSync(path), before);
  } finally { b.close(); }
});

test("validation: invalid input and inaccessible sources return actionable envelopes", () => {
  const b = bench();
  try {
    for (const [command, input] of [["ingest", {}], ["propose", { contractId: "missing", obligations: "wrong" }], ["due", { withinDays: -1 }], ["complete", { obligationId: "missing", at: "2026-02-30" }], ["in-force", { contractId: "missing", at: "yesterday" }]]) {
      assert.equal(first(b.run(text(command), input, { exit: 1 }).envelope.errors).code, "E_INPUT_SCHEMA");
    }
    const missing = b.run("ingest", { title: "Missing source", party: "provider", path: join(b.home, "missing.txt") }, { exit: 1 });
    assert.equal(first(missing.envelope.errors).code, "E_INPUT_SCHEMA");
    const contractId = b.ingest();
    const badRule = b.run("propose", { contractId, obligations: [{ summary: "Deliver report", party: "provider", clause_ref: "report", quote, recurrence: "every:0month" }] }, { exit: 1 });
    assert.equal(first(badRule.envelope.errors).code, "E_BAD_RECURRENCE");
  } finally { b.close(); }
});
