---
name: verify-formal-contracts
description: "Check the contracts module's obligation lifecycle rules (only quote-checked obligations become due, exactly one version of an obligation is in force on any date, an amended version is never due on or after its end date) against the TLA+ model. Use when a change touches how propose checks a quote, how amend ends a version or adds a new one, how complete moves the next due date, what due or in-force return, the obligation states, or any file in spec/ or src/domain/."
---

# Formal verification for the contracts module

## What is verified

| Rule | In plain words | Harm if it breaks |
|---|---|---|
| `OnlyVerifiedCreateTasks` | Every item `due` lists comes from a version whose quote is exactly the text between `quote_start` and `quote_end` of its source, and appears there only once. | A task is created from an obligation the contract does not contain. |
| `OneVersionInForce` | From the day an accepted obligation starts until the day it is removed, exactly one of its versions is in force on every date. | Two wordings apply on the same day, or the obligation drops out of the register. |
| `SupersededNeverDue` | Every item `due` lists has a due date on which its version is in force; never a date on or after the day an amendment ended it. | People are asked to do work under wording an amendment has replaced. |

Tool: TLA+ with the TLC model checker, because the question is whether any order of propose, quote check, scheduling, completing and amending can reach a bad register. Tests only try the orders someone thought of.

Bounds and assumptions: one obligation, up to four versions, six dates, a contract text of four characters and an amendment text of three, and four candidate quotes (literal, ambiguous, absent, valid in only one of the two texts). No clock, no recurrence arithmetic, one writer. `spec/README.md` lists what is left out.

## The one command

From the repo root:

```sh
bash spec/check.sh && npm ci && npx tsc --noEmit
```

`spec/check.sh` needs [mise](https://mise.jdx.dev), `curl` and Node. It installs the Java pinned in `.mise.toml`, downloads `tla2tools.jar` from the address pinned there into `~/.cache/ambitious/` and refuses it unless its SHA-256 matches the pin. It runs the model (must pass) and every variant in `spec/broken/` (each must break the rule named in `spec/broken/EXPECTED.json`). It takes a few seconds and ends with a line that starts `OK:`.

## Covered code

Last confirmed in step with the code at commit `661ec69fbdec141c71ea40dce12cabcc079686e8`. At that commit the module's code does not exist yet; the model describes the design in `spec/README.md` and the types in `src/domain/types.ts`.

| Model part | Code it describes |
|---|---|
| `Propose` | `propose` recording an obligation; `ProposedObligation`, `UncheckedQuote` |
| `AcceptQuote`, `RejectQuote`, `IsUniqueSpan`, `SpanOf` | the quote check in `propose`; `QuoteCheck`, `VerifiedQuote`, `QuoteSpan`, `QuoteRejection` |
| `Activate` | working out the first `next_due` from the recurrence; `ActiveObligation` |
| `CompleteAndAdvance`, `CompleteLast` | `complete`; `DoneObligation`, `SupersededObligation` |
| `AmendReplace`, `AmendRemove`, `Ended`, `Successor`, `CanAmend` | `amend`; `Amendment`, `Ending` |
| `DueItems` | `due`; `DueItem` |
| `InForce`, `Covered` | `in-force` |
| the `state` field and `RowOK` | `ObligationState`, `OBLIGATION_TRANSITIONS`, `Obligation` |

Run `git log 661ec69fbdec141c71ea40dce12cabcc079686e8..HEAD -- src spec migrations`. If it lists commits, read them against the table before you trust a pass. Move the commit above forward only after you have confirmed that every row still describes the code at the new commit.

One step in the model is one transaction in the code. `AmendReplace` in particular ends the old version and adds the new one together; if the code ever does those in two transactions, the model no longer describes it, so model the split before relying on a pass.

## Reading a result

If your agent setup has the `/statechart` skill, read every result with it. It is part of pstack, a public plugin of agent skills for the Cursor editor (search for "pstack" in Cursor's plugin marketplace). It runs the checker, reports each broken rule as its shortest path in plain words, and draws the states as a chart when the model passes. Refer to it by name; do not copy its commands here. Without it, read TLC's output directly as follows.

When a check fails, `spec/check.sh` prints TLC's full output. Find the line `Error: Invariant <Rule> is violated.`; the rule it names is the one that broke. Below it TLC prints the shortest path to the bad state as numbered states (shortened here to the last one):

```text
Error: Invariant SupersededNeverDue is violated.
Error: The behavior up to this point is:
State 1: <Initial predicate>
State 2: <Propose(o1,<<"b">>) ...>
State 3: <AcceptQuote(o1,1) ...>
State 4: <Activate(o1,1,2) ...>
State 5: <AmendReplace(o1,2,<<"a">>) line 95, col 3 to line 99, col 77 of module AmendKeepsOldSchedule>
register = ( o1 :>
      << [ source |-> "contract",
           quote |-> <<"b">>,
           state |-> "active",
           span |-> [start |-> 1, end |-> 2],
           from |-> 1,
           to |-> 2,
           nextDue |-> 2 ],
         [ source |-> "amendment",
           quote |-> <<"a">>,
           state |-> "verified",
           span |-> [start |-> 1, end |-> 2],
           from |-> 2,
           to |-> None,
           nextDue |-> None ] >> )
```

Each `State N` header names the step that led to that state with its arguments, and the lines under it give the register after the step. Read down the list and compare each state with the one before: what changed is what the step did. The last state breaks the rule. Write the path as one line per step before deciding anything. Here: an obligation is proposed with the quote `b`; the quote check accepts it; it is scheduled with its first due date on day 2; an amendment effective on day 2 adds version 2 and ends version 1 on day 2, but version 1 is still `active` and due on day 2, a day it is no longer in force.

To tell a path in the module's words:

- `register` lists the versions of obligation `o1`, oldest first. The position in the list is the version number.
- `state` is the obligation state. `source` says which text the quote is checked against: the contract or the amendment that created the version.
- `quote` is the proposed quote, one letter per character. `span` is where it was found (`quote_start`, `quote_end`, counted from zero, end exclusive), or `None` before the check.
- `from` is the first date the version is in force. `to` is the first date it is no longer in force, or `None` while it has no end.
- `nextDue` is `next_due`, or `None` when nothing is scheduled.
- Step arguments: `Activate(o1,1,2)` schedules version 1 with first due date 2; `CompleteAndAdvance(o1,1,3)` completes version 1's current occurrence and moves its next due date to 3; `AmendReplace(o1,2,<<"a">>)` is an amendment effective on day 2 whose restated obligation quotes `a`; `AmendRemove(o1,2)` ends the obligation on day 2.

To run one model by hand and keep the output, from the repo root:

```sh
(cd spec/broken && mise exec -- java -cp ~/.cache/ambitious/tla2tools-*.jar tlc2.TLC -workers 1 -metadir "$(mktemp -d)" -noGenerateSpecTE -config AmendKeepsOldSchedule.cfg AmendKeepsOldSchedule.tla)
```

When the model passes, the `PASS` line gives the number of distinct states TLC checked. `spec/check.sh` fails if that number is too small for the model to be exploring anything.

## Real bug or modeling error

1. Replay the path against the real code, one command per step, as a test. If the code does the same, it is a real bug: report it with the path. Do not weaken the rule, and do not change product code unless asked.
2. If the code cannot take one of the steps, the model allows something the code forbids. Find the guard in the code, add it to the model, and say so in the pull request.
3. If a broken variant stops failing, or breaks a different rule, the model changed so that the rule can no longer catch that mistake. Treat that as a failure of the model.

## Changing things on purpose

- Change `spec/ObligationLifecycle.tla` first, then make the same change in each file in `spec/broken/`, keeping only its own mistake. `check.sh` fails if a variant drifts further from the model, or uses other constants.
- A new rule needs a new broken variant that breaks it, an entry in `spec/broken/EXPECTED.json` and a row in `spec/README.md`. `check.sh` fails if a rule has no variant.
- To move to another TLC build, change `TLA2TOOLS_URL` and `TLA2TOOLS_SHA256` in `.mise.toml` together.
- Run the one command, then update the commit in "Covered code".
