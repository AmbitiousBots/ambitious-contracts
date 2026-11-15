# Formal model of the obligation lifecycle

The contracts module keeps a register of obligations taken from contracts. An obligation is proposed with a quote from the contract, accepted only if that quote appears word for word in the source text, scheduled, completed occurrence by occurrence, and replaced or removed when an amendment changes its clause. This folder holds a small model of that lifecycle and checks, for every order in which those steps can happen, that the rules below are never broken. It was written before the module's code, so the code is written against rules that are already checked.

Run it from the repo root:

```sh
bash spec/check.sh
```

Run `mise trust && mise install` first to install the pinned Node and Java versions. The kit runner downloads TLC, the model checker for TLA+, from the address pinned in `.mise.toml`, keeps it under `~/.cache/tla2tools/` by default, and refuses a file whose SHA-256 differs from the pin. A run takes a few seconds. `scripts/check-models.mjs` retains the model-specific checks for invariant coverage, matching constants, small broken variants and at least 1,000 explored states.

## `ObligationLifecycle.tla`: the model

The register holds the versions of one obligation, oldest first. Every version has a state, the text it quotes from (the contract or an amendment), its quote and where the quote was found, the first date it is in force (`from`), the first date it is no longer in force (`to`, empty while open-ended) and its next due date.

```text
proposed -> verified -> active -> done
    \                      \
     -> rejected            -> superseded
```

| Step in the model | What it stands for in the code |
|---|---|
| `Propose` | `propose` records an obligation with its quote. Nothing is trusted yet. |
| `AcceptQuote` | The quote check passes: the quote appears exactly once in the normalized source text. The obligation becomes `verified` and the place it was found is stored as `quote_start` and `quote_end`. |
| `RejectQuote` | The quote check fails, because the quote is not in the text (`E_QUOTE_NOT_LITERAL`) or appears more than once (`E_AMBIGUOUS_QUOTE`). The obligation becomes `rejected` and stays that way. |
| `Activate` | The first due date is worked out from the recurrence, on or after the date the version comes into force. The obligation becomes `active`. |
| `CompleteAndAdvance` | `complete` on a recurring obligation: the next due date moves forward. If the version has an end date and the new due date is on or after it, the version becomes `superseded` instead. |
| `CompleteLast` | `complete` on the last occurrence (a one-off obligation, or a series that has ended). The obligation becomes `done`. |
| `AmendReplace` | `amend` with a restated obligation. In one step the current version gets the amendment's effective date as its end date, and a new version starts on that date. The new version's quote must appear exactly once in the amendment's text, or nothing changes. |
| `AmendRemove` | `amend` that ends the obligation without a new version. |
| `DueItems` | What `due` lists: the next due date of every `active` version, and nothing else. |
| `InForce` | What `in-force` answers: an accepted version is in force on a date from `from` up to, but not including, `to`. |

In the code, `propose` records and checks an obligation in one transaction. The model lets other steps happen between `Propose` and the check, which only makes the check stricter.

When an amendment ends a version, the version becomes `superseded` at once unless an occurrence is still due before the amendment's effective date. In that case it stays `active` until that occurrence is completed, because a due date that falls before the amendment is still owed under the old wording.

| Rule | In plain words | Harm if it breaks |
|---|---|---|
| `OnlyVerifiedCreateTasks` | Every item `due` lists comes from a version whose stored quote is, character for character, the text between `quote_start` and `quote_end` of its own source, and appears nowhere else in it. | A task is created from an obligation the contract does not contain: an invented or paraphrased clause, or one that cannot be traced to a single place. |
| `OneVersionInForce` | On every date from the day an accepted obligation starts until the day it is removed, exactly one of its versions is in force. Before and after, none is. | Two wordings of the same obligation apply on the same day, or none does and the obligation silently drops out of the register. |
| `SupersededNeverDue` | Every item `due` lists has a due date on which its version is in force. A version is never due on or after the date an amendment ended it. | People are asked to do work under wording that an amendment has replaced. |

`TypeOK` is also checked: every value stays in its allowed set, a version has a next due date exactly when it is `active`, a `superseded` version has an end date, and an end date is always later than the start date. TLC also checks that the register never gets stuck before every version is `rejected`, `done` or `superseded`.

The model checks about 39,800 distinct states.

### How the quote check is modeled

The source texts are short sequences of letters; each letter stands for one character of normalized text. The contract is `a b a c` and the amendment is `c a c`. Four quotes can be proposed:

| Quote | In the contract | In the amendment |
|---|---|---|
| `b` | once: accepted | absent: rejected |
| `a` | twice: rejected as ambiguous | once: accepted |
| `a c` | once: accepted | once: accepted |
| `c b` | absent: rejected | absent: rejected |

So the model covers a literal quote, an ambiguous one, a quote that is not in the text, and quotes that are valid in one document but not in the other. Positions count from zero and the end is exclusive, as in the code: `b` in the contract is `start 1, end 2`.

### Bounds and what the model leaves out

- One obligation, at most four versions (three amendments that restate it), six dates, and the two texts above. Obligations do not affect each other, so one is enough; an amendment that touches several obligations applies the same step to each.
- There is no clock. `due` in the code also filters by a lead-time window, which only makes its list shorter, so the rules hold for it too.
- Recurrence arithmetic (month ends, leap years) is not modeled; a next due date is any later date. That belongs to property tests.
- Text normalization, file hashing and the event log are not modeled.
- One writer. Two processes writing at once are kept apart by database transactions, which this model does not describe.
- Tasks that were already handed to the tasks module before an amendment was recorded are not tracked. Whoever handed them over has to cancel them.
- An obligation that was removed is never reopened. Restating it later is a new obligation.

## `broken/`: showing that each rule can fail

Each file in `spec/broken/` is the model with one small, plausible mistake. `check.sh` requires each to break the rule listed for it in `broken/EXPECTED.json`, to use the same constants as the model, and to differ from the model in at most six lines. It also requires every rule in `ObligationLifecycle.cfg` to have a variant that breaks it.

| Variant | The mistake | Rule it must break | Shortest path TLC finds |
|---|---|---|---|
| `AcceptWithoutQuoteCheck` | A proposed obligation is accepted without checking its quote. | `OnlyVerifiedCreateTasks` | An obligation is proposed with the quote `a`, which appears twice in the contract; it is accepted and scheduled; `due` lists it. |
| `AmendWithoutSuperseding` | An amendment adds the new version but does not end the old one. | `OneVersionInForce` | An obligation is accepted and scheduled; an amendment effective on day 2 adds version 2; on day 2 both versions are in force. |
| `AmendKeepsOldSchedule` | An amendment ends the old version but leaves it `active` whatever its next due date is. | `SupersededNeverDue` | Version 1 is next due on day 2; an amendment takes effect on day 2; version 1 is still listed as due on day 2. |
| `CompleteIgnoresAmendment` | `complete` moves the next due date forward without looking at the version's end date. | `SupersededNeverDue` | Version 1 is due on day 1; an amendment takes effect on day 2; day 1 is completed and version 1 becomes due on day 2. |

## What this constrains in the code

- A proposed obligation is accepted only when its quote appears exactly once in the normalized text, and the place it was found is stored. `AcceptWithoutQuoteCheck` is what happens otherwise.
- A restated obligation is checked against the amendment's text, not the contract's.
- `amend` ends the old version and adds the new one in one transaction, with the old version's end date equal to the new version's start date. `AmendWithoutSuperseding` is what happens otherwise.
- An amendment's effective date must be later than the start date of the version it ends, and only the latest version, while `active`, can be amended.
- `amend` marks the old version `superseded` at once when its next due date is on or after the amendment's effective date, and `complete` does the same when it would move the next due date to or past the end date. With both in place, `due` can list the next due date of every `active` version without comparing dates against amendments. `AmendKeepsOldSchedule` and `CompleteIgnoresAmendment` are what happens otherwise.
- The types in `src/domain/types.ts` name the same things: `ObligationState` and `OBLIGATION_TRANSITIONS` (the states and arrows above), `UncheckedQuote`, `VerifiedQuote` and `QuoteSpan` (a quote before and after the check), `QuoteSource` (which text a quote is checked against), `Ending` (a version's end date, the amendment that set it and the version that replaces it), `ActiveObligation.nextDue` and `DueItem`.
