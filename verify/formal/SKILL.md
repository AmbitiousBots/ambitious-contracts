---
name: verify-formal-contracts
description: Check the obligation lifecycle model and its mapping to quote verification, amendment windows, due work and completion. Use when those behaviors or their database constraints change.
---

# Formal verification for the contracts module

## What is verified

TLA+ models the ordering of quote acceptance, scheduling, completion and amendment. TLC explores all reachable states inside the configured bounds. These rules prevent invented tasks, overlapping versions and work scheduled under expired wording.

| Invariant | Runtime enforcement |
|---|---|
| `OnlyVerifiedCreateTasks` | `src/domain/quotes.ts` checks a unique literal span. `proposeVersion` in `src/domain/register.ts` only activates a successful quote. `dueItem` rechecks the source and offsets before suggesting a task. |
| `OneVersionInForce` | `endVersion` sets an exclusive end date equal to the replacement's start. `amend` in `src/db/store.ts` updates the predecessor and adds the replacement in the kit's single write transaction. `versionInForce` applies those half-open windows. |
| `SupersededNeverDue` | `endVersion` preserves only occurrences before the cutoff. `completeVersion` bounds recurrence by the end date. `dueItem` checks the occurrence's effective window. The migration also rejects an active due date outside its window. |
| `TypeOK` | `src/domain/types.ts` defines lifecycle states and scalar guards. The `obligations` table in `migrations/0001_create_register.sql` constrains states, versions, quote offsets, active due dates and ending windows. |

`propose` records proposed, verified and active events in one write transaction. Rejected proposals have no due date. Replacement quotes come from the amendment's stored normalized text. A future amendment retains earlier backlog; recurring completion stops at its boundary. A one-time completion becomes done.

## Bounds and assumptions

The model has one obligation, at most four versions, six abstract dates, two short source texts and four candidate quotes. One abstract step corresponds to one atomic write transaction. The runtime may enforce additional guards, such as a contract end date or a supported recurrence grammar, which narrow the allowed transitions.

The model does not cover calendar arithmetic, source decoding and hashing, normalization, event persistence, filesystem behavior, concurrent processes or work already sent to another module. Unit, property, migration and CLI tests cover those runtime behaviors where applicable. The kit serializes writers with SQLite transactions; this is an implementation property, not a concurrency proof from this model.

## Run

Install [mise](https://mise.jdx.dev), then run from the repository root:

```sh
mise trust && mise install
npm ci
npm run tlc
npm test
```

`npm run tlc` calls `spec/check.sh`, which invokes `scripts/check-models.mjs`. It retains the requirements for matching constants, small broken variants, coverage of each lifecycle invariant and at least 1,000 explored states. The shared kit runner `scripts/tlc.mjs` downloads the checksum-pinned TLC jar, uses the pinned Java with one worker, and checks the passing model and every expected failure. Its default cache is `~/.cache/tla2tools/`.

A passing run reports 39,825 states for the lifecycle model and four broken variants that each violate their expected invariant. A syntax error or a different violated invariant fails the gate. Property tests additionally generate amendment histories and calendar schedules; migration and CLI tests exercise the corresponding real transitions.

## Covered code

Last confirmed in step with implementation commit `657835bd48665f2217d474af34cd6b3cd08b5d21`.

Covered files are `src/domain/quotes.ts`, `src/domain/recurrence.ts`, `src/domain/register.ts`, `src/domain/types.ts`, `src/db/store.ts`, `src/cli/main.ts` and `migrations/0001_create_register.sql`. The invariant table names the functions enforcing each rule. Their behavior is exercised by `test/lifecycle.test.ts`, `test/recurrence.test.ts`, `test/quotes.test.ts`, `test/migrations/0001_create_register.test.ts` and `test/cli.test.ts`.

```sh
git log 657835bd48665f2217d474af34cd6b3cd08b5d21..HEAD -- src migrations spec test
```

Read any later changes against the mapping before trusting a pass. Advance the recorded commit only after checking the mapping and rerunning the commands. An amendment split across transactions would invalidate the atomicity assumption.

## Read results with statechart

Use pstack's `/statechart` skill when available. pstack is a public collection of coding-agent skills available through Cursor's plugin marketplace. The skill presents invariant violations as their shortest paths in plain words; refer to it by name because its installation-specific commands can change. Without it, read the TLC invariant and state sequence directly.

| Broken variant | Counterexample in plain words |
|---|---|
| `AcceptWithoutQuoteCheck` | Propose a quote appearing twice, accept it without the uniqueness check, activate it, then list it as due. |
| `AmendWithoutSuperseding` | Accept and activate a version, then add a replacement without closing the original window; both versions cover the replacement date. |
| `AmendKeepsOldSchedule` | End a version on its next due date but leave that occurrence scheduled; it is due on a day the old wording no longer covers. |
| `CompleteIgnoresAmendment` | Keep an earlier owed occurrence after an amendment, complete it, then advance the old version across its cutoff. |

Replay a reported path through the CLI before deciding whether the implementation or model is wrong. Never weaken an invariant to obtain a pass. If an intended behavior changes the transition structure, update the model and its broken variants together before relying on it again. The existing model files remain unchanged in this implementation.
