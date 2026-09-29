CREATE TABLE updates (
  update_id   INTEGER PRIMARY KEY,
  kind        TEXT    NOT NULL CHECK (kind IN ('message', 'edited_message', 'callback_query')),
  chat_id     INTEGER NOT NULL,
  user_id     INTEGER,
  raw         TEXT    NOT NULL,
  status      TEXT    NOT NULL CHECK (status IN ('processing', 'done', 'failed', 'parked')),
  attempts    INTEGER NOT NULL CHECK (attempts BETWEEN 1 AND 3),
  last_error  TEXT,
  received_at TEXT    NOT NULL,
  claimed_at  TEXT    NOT NULL,
  finished_at TEXT
) STRICT;

CREATE INDEX updates_received_at ON updates (received_at);
CREATE INDEX updates_parked ON updates (received_at) WHERE status = 'parked';

CREATE TABLE members (
  user_id       INTEGER PRIMARY KEY,
  display_name  TEXT NOT NULL,
  username      TEXT,
  first_seen_at TEXT NOT NULL,
  updated_at    TEXT NOT NULL
) STRICT;

CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
