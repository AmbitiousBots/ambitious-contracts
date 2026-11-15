import { readCommand, writeCommand } from "@ambitious/kit/cli/command";
import { embedded } from "@ambitious/kit/cli/embedded";
import { runCli } from "@ambitious/kit/cli/run-cli";
import { amend, complete, due, inForce, ingest, propose } from "../db/store.ts";
import { parseAmend, parseComplete, parseDue, parseInForce, parseIngest, parsePropose } from "../domain/inputs.ts";
import { readSource } from "./source.ts";

await runCli({
  ...embedded(),
  schemaVersion: 1,
  commands: {
    ingest: writeCommand({
      input: (raw) => {
        const input = parseIngest(raw);
        return { input, source: readSource(input.path) };
      },
      run: ({ input, clock, db }) => ingest(db, input.input, input.source, clock.now().toISOString()),
    }),
    propose: writeCommand({
      input: parsePropose,
      run: ({ input, clock, db }) => propose(db, input, clock.now().toISOString()),
    }),
    amend: writeCommand({
      input: (raw) => {
        const input = parseAmend(raw);
        return { input, source: readSource(input.path) };
      },
      run: ({ input, clock, db }) => amend(db, input.input, input.source, clock.now().toISOString()),
    }),
    "in-force": readCommand({ input: parseInForce, run: ({ input, clock, db }) => inForce(db, input, clock.now().toISOString()) }),
    due: readCommand({ input: parseDue, run: ({ input, clock, db }) => due(db, input, clock.now().toISOString()) }),
    complete: writeCommand({ input: parseComplete, run: ({ input, clock, db }) => complete(db, input, clock.now().toISOString()) }),
  },
});
