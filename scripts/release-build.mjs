import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const asset = `ambitious-contracts-${version}.mjs`;
const directory = join(root, "release");
mkdirSync(directory, { recursive: true });
copyFileSync(join(root, "dist", "ambitious-contracts.mjs"), join(directory, asset));
chmodSync(join(directory, asset), 0o755);
const digest = createHash("sha256").update(readFileSync(join(directory, asset))).digest("hex");
writeFileSync(join(directory, "SHA256SUMS"), `${digest}  ${asset}\n`);
const scratch = mkdtempSync(join(tmpdir(), "contracts-release-"));
try {
  const binary = join(scratch, asset);
  copyFileSync(join(directory, asset), binary);
  const result = spawnSync(process.execPath, [binary, "selfcheck", "--now", "2026-01-01T00:00:00Z", "--seed", "7"], {
    cwd: scratch,
    env: { ...process.env, AMBITIOUS_HOME: join(scratch, "home") },
    encoding: "utf8",
    input: "",
    timeout: 60_000,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const envelope = JSON.parse(result.stdout);
  assert.equal(envelope.ok, true);
  assert.equal(envelope.meta.version, version);
  assert.equal(envelope.data.binary.sha256, digest);
  assert.equal(envelope.data.db.integrityCheck, "ok");
  assert.deepEqual(envelope.data.problems, []);
  process.stdout.write(`release: ${asset}\nrelease: SHA256SUMS verified by isolated binary selfcheck\n`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
