import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const home = mkdtempSync(join(tmpdir(), "contracts-release-check-"));
const root = join(import.meta.dirname, "..");
const checks = [
  ["npm", ["run", "typecheck"]],
  ["npm", ["run", "lint"]],
  ["npm", ["run", "depcruise"]],
  ["npm", ["test"]],
  ["npm", ["run", "contract"]],
  ["npm", ["run", "tlc"]],
  [process.execPath, ["verify/run"]],
  ["npm", ["run", "release:build"]],
  [process.execPath, ["scripts/tasks-handoff.mjs"]],
  ["npm", ["audit"]],
];
try {
  for (const [program, args] of checks) {
    process.stdout.write(`\n$ ${program === process.execPath ? "node" : program} ${args.join(" ")}\n`);
    const result = spawnSync(program, args, {
      cwd: root,
      env: { ...process.env, AMBITIOUS_HOME: home },
      stdio: "inherit",
    });
    if (result.error !== undefined) throw result.error;
    if (result.status !== 0) {
      process.exitCode = result.status ?? 1;
      break;
    }
  }
  if (process.exitCode === undefined) {
    const binary = join(root, "dist", "ambitious-contracts.mjs");
    const invoke = (command, input, extra = []) => {
      const result = spawnSync(process.execPath, [binary, command, "--now", "2026-01-01T00:00:00Z", "--seed", "7", ...extra], {
        cwd: root,
        env: { ...process.env, AMBITIOUS_HOME: home },
        encoding: "utf8",
        input,
        timeout: 60_000,
      });
      assert.equal(result.status, 0, result.stdout || result.stderr);
      return JSON.parse(result.stdout);
    };
    const ingested = invoke("ingest", JSON.stringify({ title: "Service agreement", party: "provider", path: "test/fixtures/contract.txt" }));
    assert.equal(ingested.data.contractId, "contract-1");
    const rejected = invoke("propose", "", ["--in", "test/fixtures/paraphrased-quote.json"]);
    assert.equal(rejected.data.rejected[0].code, "E_QUOTE_NOT_LITERAL");
    process.stdout.write("$ node dist/ambitious-contracts.mjs propose --in test/fixtures/paraphrased-quote.json\n");
    process.stdout.write(`${JSON.stringify(rejected)}\n`);
    process.stdout.write("release:check: all checks passed\n");
  }
} finally {
  rmSync(home, { recursive: true, force: true });
}
