# ambitious-contracts

Ambitious Contracts is a command-line obligation register. A bot supplies contract text and proposed obligations. The module accepts a proposal only when its quote occurs exactly once in the normalized source, tracks amendments and recurring due dates, and suggests work for the tasks module.

The module runs locally on Node 24. It makes no network or AI calls and needs no API key. It stores one SQLite database and prints one JSON envelope for every command. It does not interpret legal terms or render documents. A person reviews the bot's proposed interpretation before relying on it.

## Build and try it

Install [mise](https://mise.jdx.dev), then run:

```sh
mise trust
mise install
npm ci
npm run build
export AMBITIOUS_HOME="$(mktemp -d)"
node dist/ambitious-contracts.mjs selfcheck --now 2026-01-01T00:00:00Z --seed 7
printf '%s\n' '{"title":"Service agreement","party":"provider","path":"test/fixtures/contract.txt"}' | node dist/ambitious-contracts.mjs ingest --now 2026-01-01T00:00:00Z --seed 7
node dist/ambitious-contracts.mjs propose --in test/fixtures/paraphrased-quote.json --now 2026-01-01T00:00:00Z --seed 7
```

The final command reports `E_QUOTE_NOT_LITERAL` in `data.rejected`. It uses `contract-1`, the first contract in this fresh database. Use the actual `contractId` returned by `ingest` in an existing register.

A literal proposal against that same fixture:

```json
{
  "contractId": "contract-1",
  "obligations": [{
    "summary": "Deliver the monthly report",
    "party": "provider",
    "clause_ref": "report",
    "quote": "The provider delivers a monthly report.",
    "recurrence": "every:1month@2026-01-31",
    "lead_days": 7
  }]
}
```

Save this JSON and pass it to `propose --in <file>`, or send it on stdin. Run `due` with `{"withinDays":30}` to get the next occurrence and a suggested task payload. Read [skills/contracts-for-bots/SKILL.md](skills/contracts-for-bots/SKILL.md) for the bot workflow.

## Commands

Every command accepts `--db <path>`, `--now <ISO8601 with zone>`, `--seed <uint32>` and `--json`. Input commands accept stdin or `--in <file>`, never both. `--json` changes nothing; output is always JSON. `commands` lists access modes and whether input is needed.

| Command | Input | Result in `data` |
|---|---|---|
| `commands` | None | `commands` with each name, access mode and input requirement. |
| `selfcheck` | None | Runtime, binary checksum, database integrity, migration status and problems. |
| `ingest` | `{title,party,path,effective_from?,effective_to?}` | `{contractId,sha256}`. |
| `propose` | `{contractId,obligations:[{summary,party,clause_ref,quote,recurrence?,lead_days?}]}` | `{accepted,rejected}`. Rejections include the input index, code and reason. |
| `amend` | `{contractId,path,clause_ref,effective_from,replacements?}` | `{amendmentId,superseded,accepted}`. |
| `in-force` | `{contractId?,at?}` | `{obligations}` covering the selected date. Defaults to all contracts at the UTC date of `--now`. |
| `due` | `{withinDays?}` | `{items:[{obligation,due,suggestedTask}]}`. Defaults to zero days. |
| `complete` | `{obligationId,at}` | `{obligation}` after completing exactly one occurrence. |

Dates in command input are real calendar dates, `YYYY-MM-DD`, from year 0001 through 9999. `effective_from` defaults to the UTC date of `--now`; `effective_to` is exclusive and defaults to no end. Reingesting the same title, party, source hash and effective dates returns the existing ID. Unknown input fields are rejected.

`ingest` reads UTF-8 text. Convert PDFs to text before calling it. The SHA-256 identifies the original file bytes. Stored text uses Unicode NFC, collapsed whitespace and trimmed ends. Quotes are checked exactly as provided against that normalized text. Offsets count JavaScript UTF-16 code units, start inclusive and end exclusive, so `text_normalized.slice(quote_start, quote_end) === quote`. Repeated quotes, including overlapping matches, require more surrounding words.

Accepted proposals record `proposed → verified → active` events in one transaction. Rejections remain in the register with no due date. The active state means the quote was verified and a due date was assigned. Repeating `propose` creates new obligations; inspect `in-force` after an uncertain response before retrying.

## Recurrence and due work

| Grammar | Meaning |
|---|---|
| `once:2026-06-30` | One due date. |
| `every:2week@2026-01-01` | Every two weeks from an explicit anchor. |
| `every:1month` | Monthly from the version's effective start. |
| `rrule:FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=31` | The supported RFC 5545 subset; invalid dates are omitted. |

`every` accepts positive whole intervals with `day`, `week`, `month` or `year`. An optional `@YYYY-MM-DD` supplies its anchor. Monthly and yearly `every` schedules clamp to a shorter month's last day but retain the original anchor: January 31, February 28, March 31. A February 29 yearly anchor returns to February 29 in leap years.

The `rrule:` subset accepts `FREQ=DAILY|WEEKLY|MONTHLY|YEARLY`, optional positive `INTERVAL`, and one optional `BYMONTHDAY` for monthly rules, from -31 through -1 or 1 through 31. Negative values count backward from the end of the month. Other fields, lists and combinations are rejected. RFC rules omit nonexistent dates; they do not clamp them. The effective start supplies the recurrence anchor. The module rejects recurrences with no occurrence within the version's effective dates or the supported calendar.

An omitted recurrence becomes a one-time occurrence at the later of the UTC date of `--now` and the version's effective start. `lead_days` defaults to zero. `due` includes overdue work and next occurrences due on or before `--now`'s UTC date plus `withinDays` plus that obligation's lead time. It returns only quote-verified active versions whose due date lies within their effective window.

`complete` advances from the stored due date, not from the completion date. Early work is allowed. Late completion advances one occurrence and leaves other missed occurrences due. This preserves the sequence without silently skipping backlog. A completed one-time obligation becomes `done`.

`suggestedTask` is input for `ambitious-tasks add`. It contains `title`, `list: "contracts"`, `due`, `labels`, `done_when` and `idem_key: "contract:<obligationId>:<next_due>"`. Forward it unchanged to keep retries idempotent. This module never starts another module or writes its database.

## Amendments and history

Without `replacements`, `amend` ends every latest active obligation for the selected clause. To restate one, include:

```json
{
  "contractId": "contract-1",
  "path": "amendment.txt",
  "clause_ref": "report",
  "effective_from": "2026-04-01",
  "replacements": [{
    "obligationId": "obligation-1",
    "summary": "Deliver the revised report",
    "party": "provider",
    "quote": "The provider delivers a revised report.",
    "recurrence": "every:1month",
    "lead_days": 7
  }]
}
```

Each replacement identifies an affected latest active obligation and must quote the amendment source uniquely. Omitted obligations for that clause are removed. A failed replacement rolls back the whole amendment. Amendments must take effect strictly after the version starts and before an existing end date. To prevent reintroducing old wording, `propose` refuses clauses already amended; subsequent changes use `amend`.

The old version ends exactly when the replacement starts. Dates before that boundary still return the old version through `in-force`. Work already due before the boundary remains available until completed. Its recurrence stops at the boundary, while replacement work follows its own schedule. `superseded` in the amendment response lists ended versions; an ended version can remain active while earlier work is outstanding.

Completed versions remain part of historical `in-force` results. State changes append to `obligation_events`; stored event rows cannot be updated or deleted through SQL. Work already sent to another module is outside this register; the bot must review or cancel those tasks after an amendment.

## Storage and installation

The database is `$AMBITIOUS_HOME/contracts/contracts.sqlite`. `AMBITIOUS_HOME` defaults to `/workspace/ambitious`, the persistent module directory on a Grok Bot computer. Use a directory of your choice elsewhere. `--db` overrides the database path. `due` and `in-force` open it read-only and require `selfcheck` on a fresh installation. Writers use WAL, foreign keys and a transaction for each command. Forward-only migrations live in `migrations/` and are embedded in the bundle.

The bot's private state directory, `/home/box/agent-data`, is refused for database, JSON input and source document paths, including symbolic-link aliases. The module reads no API keys. The [module contract](MODULE_CONTRACT.md) defines the envelope and all shared behavior.

`npm run release:build` writes `release/ambitious-contracts-0.1.1.mjs` and `release/SHA256SUMS`. The executable bundles the kit and migrations and runs without npm dependencies. The [kit release](https://github.com/AmbitiousBots/ambitious-kit/releases/tag/kit-v0.4.9) provides a checksum-verifying installer. After downloading and verifying that installer, install a local release with:

```sh
node ambitious-install-0.4.9.mjs contracts 0.1.1 --from ./release
```

It writes `$AMBITIOUS_HOME/bin/ambitious-contracts` and is safe to repeat. Run the installed binary's `selfcheck` on routine starts.

## Errors

Envelope failures exit 1 for input or lifecycle errors, and 2 for internal or storage errors. A successful `propose` can still contain rejected proposals in `data.rejected`; inspect both arrays.

| Code | Exit | Meaning | Typical hint |
|---|---|---|---|
| `E_INPUT_SCHEMA` | 1 | Missing or invalid JSON fields, unreadable text or invalid dates. | Use the documented input and readable UTF-8 files. |
| `E_USAGE` | 1 | Unknown command, invalid flags or conflicting input sources. | Check `commands` and the shared flags. |
| `E_FORBIDDEN_PATH` | 1 | A path resolves inside the bot's private state directory. | Use a source or database outside that directory. |
| `E_UNKNOWN_CONTRACT` | 1 | The contract ID does not exist. | Use the ID returned by `ingest`. |
| `E_UNKNOWN_OBLIGATION` | 1 | The obligation does not exist or is not an amendment target. | Use an obligation from `in-force` or `due`. |
| `E_BAD_RECURRENCE` | 1 | Unsupported syntax or no valid occurrence in the date window. | Choose a supported rule within the effective dates. |
| `E_QUOTE_NOT_LITERAL` | 1 | A quote is empty or absent from its normalized source. | Copy a literal span from the correct source. |
| `E_AMBIGUOUS_QUOTE` | 1 | A quote appears more than once. | Include enough surrounding words. |
| `E_TRANSITION` | 1 | The obligation or clause cannot take the requested action. | Inspect current versions before retrying. |
| `E_AMENDMENT_NOT_AFTER_START` | 1 | The amendment falls outside the current version's window. | Choose a later effective date within that window. |
| `E_DB` | 2 | Storage cannot be read or written, or stored values are inconsistent. | Run `selfcheck` and investigate its problems. |
| `E_MIGRATION` | 2 | Missing, outdated or incompatible database schema. | Run `selfcheck` or install the matching binary. |
| `E_INTERNAL` | 2 | An unexpected module failure. | Report the stderr log with synthetic input. |

Quote codes inside successful `propose` rejection entries do not change its exit code. Invalid amendment quotes are envelope failures and exit 1.

## Verification and contribution

```sh
npm run release:check
verify/run
```

The release check runs types, lint, import boundaries, unit and property tests, CLI contract tests, TLC, feature verification, release artifact checks, the tasks release handoff, and npm audit. Live handoff uses the [GitHub CLI](https://cli.github.com) with access to both repositories. It skips only when the tasks release is confirmed absent. Local CI checks everything that needs no cross-repository release access; the authenticated release check remains required before release.

`verify/run` maps user-visible behavior in [verify/features.json](verify/features.json) to tests using fresh temporary homes and preserves logs under the ignored `.verify-evidence/` directory. [Formal verification](verify/formal/SKILL.md) covers one obligation, four versions and six dates. Property tests cover calendar arithmetic and version windows beyond that bounded model. These checks use synthetic text; they do not establish interpretation accuracy on real contracts or operation on a hosted bot computer.

See [CONTRIBUTING.md](CONTRIBUTING.md), [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md), and [SECURITY.md](SECURITY.md). Part of [Ambitious](https://ambitiousbots.com). Licensed under [Apache-2.0](LICENSE).
