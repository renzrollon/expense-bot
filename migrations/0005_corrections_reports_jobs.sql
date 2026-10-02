ALTER TABLE expenses ADD COLUMN source_edited_at TEXT;
CREATE INDEX expenses_updated_at ON expenses (updated_at);
CREATE INDEX expenses_removed ON expenses (deleted_by, deleted_at) WHERE deleted_at IS NOT NULL;

CREATE TABLE day_marks (
  date      TEXT    PRIMARY KEY CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  marked_by INTEGER NOT NULL,
  marked_at TEXT    NOT NULL
) STRICT;

CREATE TABLE job_sends (
  job            TEXT    NOT NULL CHECK (length(job) BETWEEN 1 AND 32),
  scheduled_date TEXT    NOT NULL CHECK (scheduled_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  part           TEXT    NOT NULL CHECK (length(part) BETWEEN 1 AND 32),
  chat_id        INTEGER NOT NULL,
  message_id     INTEGER NOT NULL,
  sent_at        TEXT    NOT NULL,
  PRIMARY KEY (job, scheduled_date, part)
) STRICT;
