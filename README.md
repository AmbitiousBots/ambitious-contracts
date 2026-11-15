# ambitious-contracts

The contracts module keeps an obligation register: AI-proposed obligations are accepted only when their clause quote is a literal span of the source contract, with effective dating, amendments, recurrence and lead times that become tasks in the tasks module. It is a command-line tool with JSON in and JSON out, one SQLite file and no UI.

The module follows the shared module contract, [MODULE_CONTRACT.md](https://github.com/AmbitiousBots/ambitious-kit/blob/main/MODULE_CONTRACT.md) in ambitious-kit: one command-line binary, JSON in and a JSON envelope out, one SQLite file, deterministic with `--now` and `--seed`, no network except keyed AI calls.

Part of [Ambitious](https://ambitiousbots.com). Licensed under the Apache License, Version 2.0; see [LICENSE](LICENSE) and [NOTICE](NOTICE).
