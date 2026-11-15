---
name: verify-contracts
description: Verify the Ambitious contracts CLI from a fresh database through literal quote proposals, amendments, due task payloads and completion. Use after changes and before a release.
---

# Verify the contracts module

The user is a bot running a single executable with JSON input and output. Verification drives that executable, observes its envelopes and checks persisted behavior across separate processes.

## Launch

Install the tools pinned in `.mise.toml` with [mise](https://mise.jdx.dev), then build the executable.

```sh
mise trust && mise install
npm ci
npm run build
node verify/run --doctor
```

There is no server to start or stop. A successful doctor check means the runtime and dependencies are ready. `node verify/run` creates separate empty temporary `AMBITIOUS_HOME` directories for its checks. The CLI test harness also isolates every scenario, so simultaneous verification runs do not share databases.

## Doctor

```sh
node verify/run --doctor
```

This reads runtime and repository metadata. It does not open a product database. To diagnose a particular scratch database, invoke the built binary's `selfcheck` with that scratch `AMBITIOUS_HOME`; selfcheck applies migrations and is a write operation.

## Drive

```sh
node verify/run
node verify/run --only amendments --only due
node verify/run --list
```

`verify/features.json` maps each feature to its exact check. The CLI checks ingest `test/fixtures/contract.txt`, propose unique and invalid quotes, inspect due task payloads, complete occurrences, replace and remove clauses, and inspect history by date through `in-force`. Each command runs in a separate process against the same scenario database. The harness compares JSON results, source checksums, stored-file bytes and repeat output.

The recurrence property suite covers generated dates and intervals. The shared contract suite checks envelopes, exit codes, forbidden paths, deterministic metadata and read-only analysis. The formal check explores the lifecycle model and requires each intentionally broken variant to fail its named invariant. Read the model's scope in `verify/formal/SKILL.md`.

## Evidence

The runner prints one pass or failure row per feature and the relative location of full command logs under `.verify-evidence/`. Retain the printed evidence directory. A pass requires observable outcomes from the built executable, including persisted state observed by later commands. Compile output alone is insufficient.

For a release, run the complete gate.

```sh
npm run release:check
```

This also builds `release/`, runs the copied single-file asset outside the checkout, checks its binary checksum, runs the dependency audit and attempts the tasks-module handoff. The handoff uses a separately downloaded, checksum-verified tasks release in its own temporary database. If that release does not exist yet, the handoff prints an explicit skip. Authentication, download and execution errors fail the gate.

The automated checks use synthetic contract text. Review of real agreements and execution on a separate bot computer are external checks; passing here does not claim either occurred.

## Cleanup

Every check removes only the temporary homes it created. The runner preserves the full evidence directory and prints its path. No long-running process remains. Failed scenarios use the same cleanup path.

## Helpers

`verify/run` is executable and can also be invoked with Node. `scripts/release-build.mjs`, `scripts/release-check.mjs` and `scripts/tasks-handoff.mjs` run through Node. Update the feature map whenever a user-visible command or behavior changes.
