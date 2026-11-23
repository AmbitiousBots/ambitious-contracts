import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const repository = "AmbitiousBots/ambitious-tasks";
const tag = "tasks-v0.1.4";
const asset = "ambitious-tasks-0.1.4.mjs";
const release = spawnSync("gh", ["release", "view", tag, "-R", repository, "--json", "tagName,assets"], { encoding: "utf8", timeout: 60_000 });
if (release.error !== undefined) throw release.error;
if (release.status !== 0) {
  if (release.stderr.trim() === "release not found") {
    const repo = spawnSync("gh", ["repo", "view", repository, "--json", "nameWithOwner"], { encoding: "utf8", timeout: 60_000 });
    assert.equal(repo.status, 0, "Cannot verify that the tasks repository is accessible; release absence is unconfirmed.");
    assert.equal(JSON.parse(repo.stdout).nameWithOwner.toLowerCase(), repository.toLowerCase());
    process.stdout.write(`SKIP tasks handoff: ${tag} has not been released in ${repository}. Payload shape is checked by the local CLI suite.\n`);
  } else {
    throw new Error(`Cannot determine whether the tasks release exists: ${release.stderr.trim()}`);
  }
} else {
  const metadata = JSON.parse(release.stdout);
  assert.equal(metadata.tagName, tag);
  assert(metadata.assets.some((entry) => entry.name === asset), `Release is missing ${asset}.`);
  assert(metadata.assets.some((entry) => entry.name === "SHA256SUMS"), "Release is missing SHA256SUMS.");
  const scratch = mkdtempSync(join(tmpdir(), "contracts-tasks-handoff-"));
  try {
    const download = spawnSync("gh", ["release", "download", tag, "-R", repository, "--pattern", asset, "--pattern", "SHA256SUMS", "--dir", scratch], { encoding: "utf8", timeout: 60_000 });
    assert.equal(download.status, 0, download.stderr);
    const binary = join(scratch, asset);
    const checksums = readFileSync(join(scratch, "SHA256SUMS"), "utf8").trim().split(/\r?\n/u);
    const matches = checksums.flatMap((line) => {
      const fields = /^([a-f0-9]{64})\s+\*?([^\s]+)$/u.exec(line);
      return fields?.[2] === asset ? [fields[1]] : [];
    });
    assert.equal(matches.length, 1, "The checksum manifest must identify the tasks asset exactly once.");
    assert.equal(createHash("sha256").update(readFileSync(binary)).digest("hex"), matches[0]);
    const invoke = (executable, command, input) => {
      const result = spawnSync(process.execPath, [executable, command, "--now", "2026-01-01T00:00:00Z", "--seed", "7"], {
        cwd: scratch,
        env: { ...process.env, AMBITIOUS_HOME: join(scratch, "home") },
        encoding: "utf8",
        input: input === undefined ? "" : JSON.stringify(input),
        timeout: 60_000,
      });
      assert.equal(result.status, 0, result.stdout || result.stderr);
      const envelope = JSON.parse(result.stdout);
      assert.equal(envelope.ok, true);
      return envelope.data;
    };
    const contracts = join(root, "dist", "ambitious-contracts.mjs");
    const { contractId } = invoke(contracts, "ingest", { title: "Service agreement", party: "provider", path: join(root, "test", "fixtures", "contract.txt") });
    invoke(contracts, "propose", { contractId, obligations: [{ summary: "Deliver report", party: "provider", clause_ref: "report", quote: "The provider delivers a monthly report.", recurrence: "once:2026-01-10" }] });
    const { items } = invoke(contracts, "due", { withinDays: 10 });
    assert.equal(items.length, 1);
    const payload = items[0].suggestedTask;
    const first = invoke(binary, "add", payload);
    const repeated = invoke(binary, "add", payload);
    assert.deepEqual(repeated.task, first.task, "Repeating the suggested payload must return the same task.");
    const listed = invoke(binary, "list", { list: "contracts" });
    assert.equal(listed.tasks.length, 1);
    assert.equal(listed.tasks[0].title, payload.title);
    assert.match(payload.due, /^\d{4}-\d{2}-\d{2}$/u);
    assert.equal(listed.tasks[0].due, `${payload.due}T00:00:00.000Z`);
    process.stdout.write(`tasks handoff: ${tag} checksum verified; suggested payload creates one task and is idempotent\n`);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
