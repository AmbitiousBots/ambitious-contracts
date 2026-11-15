# ambitious-contracts

The contracts module keeps an obligation register: AI-proposed obligations are accepted only when their clause quote is a literal span of the source contract, with effective dating, amendments, recurrence and lead times that become tasks in the tasks module. It is a command-line tool with JSON in and JSON out, one SQLite file and no UI.

The module follows the shared module contract, [MODULE_CONTRACT.md](https://github.com/AmbitiousBots/ambitious-kit/blob/main/MODULE_CONTRACT.md) in ambitious-kit: one command-line binary, JSON in and a JSON envelope out, one SQLite file, deterministic with `--now` and `--seed`, no network except keyed AI calls.

Part of [Ambitious](https://ambitiousbots.com). Licensed under the Apache License, Version 2.0; see [LICENSE](LICENSE) and [NOTICE](NOTICE).

## Formal model

The rules of the obligation lifecycle (only obligations whose quote was found word for word in the source become due, exactly one version of an obligation is in force on any date, a version ended by an amendment is never due on or after its end date) are checked for every order of proposing, checking, scheduling, completing and amending by a TLA+ model in [`spec/`](spec/README.md). Run it with `bash spec/check.sh`. [`verify/formal/SKILL.md`](verify/formal/SKILL.md) tells an agent or a contributor when to rerun it and how to read a failure. The domain types the module's code will build on are in [`src/domain/types.ts`](src/domain/types.ts).
