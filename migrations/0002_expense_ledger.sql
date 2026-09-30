CREATE TABLE expenses (
  id                      INTEGER PRIMARY KEY,
  chat_id                 INTEGER NOT NULL,
  source_message_id       INTEGER NOT NULL,
  item_index              INTEGER NOT NULL CHECK (item_index BETWEEN 0 AND 9),
  confirmation_message_id INTEGER,
  payer_user_id           INTEGER NOT NULL,
  amount_centavos         INTEGER NOT NULL CHECK (amount_centavos BETWEEN 1 AND 999999999),
  currency                TEXT    NOT NULL CHECK (currency GLOB '[A-Z][A-Z][A-Z]'),
  description             TEXT    NOT NULL,
  category_id             TEXT    NOT NULL CHECK (category_id <> ''),
  category_source         TEXT    NOT NULL CHECK (category_source IN ('keyword', 'learned', 'llm', 'manual', 'default')),
  spent_on                TEXT    NOT NULL CHECK (spent_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  raw_text                TEXT    NOT NULL,
  parser                  TEXT    NOT NULL CHECK (parser IN ('rules', 'llm')),
  check_amount            INTEGER NOT NULL CHECK (check_amount IN (0, 1)),
  created_at              TEXT    NOT NULL,
  created_by              INTEGER NOT NULL,
  updated_at              TEXT    NOT NULL,
  updated_by              INTEGER NOT NULL,
  deleted_at              TEXT,
  deleted_by              INTEGER,
  CHECK ((deleted_at IS NULL) = (deleted_by IS NULL))
) STRICT;

CREATE UNIQUE INDEX expenses_source_item ON expenses (chat_id, source_message_id, item_index);
CREATE INDEX expenses_spent_on ON expenses (spent_on) WHERE deleted_at IS NULL;
CREATE INDEX expenses_payer_created ON expenses (payer_user_id, created_at) WHERE deleted_at IS NULL;
