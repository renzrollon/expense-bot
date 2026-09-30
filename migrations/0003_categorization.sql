CREATE TABLE keyword_map (
  keyword     TEXT    PRIMARY KEY CHECK (keyword <> ''),
  category_id TEXT    NOT NULL CHECK (category_id <> ''),
  source      TEXT    NOT NULL CHECK (source IN ('learned', 'llm')),
  taught_by   INTEGER,
  hit_count   INTEGER NOT NULL DEFAULT 0 CHECK (hit_count >= 0),
  created_at  TEXT    NOT NULL,
  updated_at  TEXT    NOT NULL
) STRICT;
