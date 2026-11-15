CREATE TABLE contracts (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  party TEXT NOT NULL,
  source_path TEXT NOT NULL,
  source_sha256 TEXT NOT NULL,
  text_normalized TEXT NOT NULL,
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  CHECK (effective_to IS NULL OR effective_to > effective_from)
) STRICT;
CREATE TABLE amendments (
  id TEXT PRIMARY KEY,
  contract_id TEXT NOT NULL REFERENCES contracts(id),
  amends_clause_ref TEXT NOT NULL,
  source_path TEXT NOT NULL,
  source_sha256 TEXT NOT NULL,
  text_normalized TEXT NOT NULL,
  effective_from TEXT NOT NULL
) STRICT;
CREATE TABLE obligations (
  id TEXT PRIMARY KEY,
  contract_id TEXT NOT NULL REFERENCES contracts(id),
  root_id TEXT NOT NULL REFERENCES obligations(id),
  version INTEGER NOT NULL CHECK (version >= 1),
  state TEXT NOT NULL CHECK (state IN ('proposed','rejected','verified','active','done','superseded')),
  party TEXT NOT NULL,
  summary TEXT NOT NULL,
  clause_ref TEXT NOT NULL,
  quote TEXT NOT NULL,
  quote_start INTEGER,
  quote_end INTEGER,
  source_amendment_id TEXT REFERENCES amendments(id),
  recurrence TEXT NOT NULL,
  anchor TEXT NOT NULL,
  lead_days INTEGER NOT NULL CHECK (lead_days >= 0),
  next_due TEXT,
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  ending_amendment_id TEXT REFERENCES amendments(id),
  superseded_by TEXT REFERENCES obligations(id) DEFERRABLE INITIALLY DEFERRED,
  UNIQUE (root_id,version),
  CHECK ((state = 'active') = (next_due IS NOT NULL)),
  CHECK (state IN ('proposed','rejected') OR (quote_start IS NOT NULL AND quote_end > quote_start)),
  CHECK (effective_to IS NULL OR effective_to > effective_from),
  CHECK (state <> 'superseded' OR effective_to IS NOT NULL),
  CHECK (next_due IS NULL OR (next_due >= effective_from AND (effective_to IS NULL OR next_due < effective_to)))
) STRICT;
CREATE INDEX obligations_contract_clause ON obligations(contract_id,clause_ref);
CREATE INDEX obligations_due ON obligations(state,next_due);
CREATE TABLE obligation_events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  obligation_id TEXT NOT NULL REFERENCES obligations(id),
  from_state TEXT,
  to_state TEXT NOT NULL,
  at TEXT NOT NULL,
  actor TEXT NOT NULL
) STRICT;
CREATE TRIGGER obligation_events_no_update BEFORE UPDATE ON obligation_events BEGIN
  SELECT RAISE(ABORT, 'Obligation events cannot be changed.');
END;
CREATE TRIGGER obligation_events_no_delete BEFORE DELETE ON obligation_events BEGIN
  SELECT RAISE(ABORT, 'Obligation events cannot be deleted.');
END;
