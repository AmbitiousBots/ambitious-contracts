import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(path, "utf8");
const configuration = (text) => {
  const invariants = [];
  const setup = [];
  let section = "";
  for (const line of text.split("\n")) {
    if (/^[A-Z_]+/.test(line)) section = line.trim();
    if (/^INVARIANTS?$/.test(section)) {
      if (line.trim() !== section && line.trim() !== "") invariants.push(line.trim());
    } else setup.push(line);
  }
  return { invariants, setup: setup.join("\n") };
};

const name = "ObligationLifecycle";
const model = read(`spec/${name}.tla`);
const original = configuration(read(`spec/${name}.cfg`));
const expected = JSON.parse(read("spec/broken/EXPECTED.json"));
for (const invariant of original.invariants.filter((value) => value !== "TypeOK")) {
  assert(Object.values(expected).some((entry) => entry.invariant === invariant), `Add a broken variant for ${invariant}.`);
}
for (const [variant, entry] of Object.entries(expected)) {
  const candidate = configuration(read(`spec/broken/${variant}.cfg`));
  assert.deepEqual(candidate.invariants, [entry.invariant], `${variant} must check exactly its expected invariant.`);
  assert.equal(candidate.setup, original.setup, `${variant} must use the model's constants.`);
  const compared = spawnSync("diff", ["-", `spec/broken/${variant}.tla`], {
    input: model.replace(`MODULE ${name}`, `MODULE ${variant}`),
    encoding: "utf8",
  });
  assert.equal(compared.status, 1, `${variant} must differ from the model.`);
  const changed = compared.stdout.split("\n").filter((line) => /^[<>]/.test(line)).length;
  assert(changed >= 1 && changed <= 6, `${variant} must differ by one small mistake, at most six lines.`);
}

const result = spawnSync(process.execPath, ["scripts/tlc.mjs"], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
process.stdout.write(result.stdout ?? "");
process.stderr.write(result.stderr ?? "");
assert.equal(result.status, 0, "TLC must pass and each broken model must fail on its expected invariant.");
const states = Number(result.stdout.match(/found no error in (\d+) states/)?.[1] ?? 0);
assert(states > 1000, `The lifecycle model explored only ${states} states.`);
process.stdout.write("Model guards passed: invariant coverage, matching constants, small mutations, and state exploration.\n");
