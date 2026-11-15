# Contributing

Ambitious Contracts keeps a quote-backed register of obligations. Changes should make that register easier for a bot to use and preserve its evidence and date history.

Discuss a change in an issue or open a pull request against `main`. Use synthetic source text in examples and tests. Do not include private contracts, credentials or personal information.

Install [mise](https://mise.jdx.dev), then run:

```sh
mise trust
mise install
npm ci
npm run release:check
verify/run
```

The pinned Node and Java versions support the bundled CLI and the TLA+ model checker. Tests use temporary databases. Set `AMBITIOUS_HOME` to a scratch directory when trying commands by hand.

Keep input validation at the command boundary, date and quote logic in `src/domain/`, and SQLite access in `src/db/`. Add a forward-only migration for a database change. Change observable behavior and its verification together. The formal lifecycle models in `spec/` check quote acceptance and amendment windows; run them when changing those behaviors.

Pull requests explain the user benefit, include actual verification output, and state design decisions. The [module contract](MODULE_CONTRACT.md) defines envelopes, paths, deterministic execution and release behavior. Contributions are licensed under the repository's [Apache License 2.0](LICENSE).
