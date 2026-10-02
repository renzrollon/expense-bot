CREATE TABLE job_runs (
  job            TEXT    NOT NULL CHECK (length(job) BETWEEN 1 AND 32),
  scheduled_date TEXT    NOT NULL CHECK (scheduled_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  scheduled_hour INTEGER NOT NULL CHECK (scheduled_hour BETWEEN 0 AND 23),
  status         TEXT    NOT NULL CHECK (status IN ('running', 'done', 'failed', 'skipped')),
  attempts       INTEGER NOT NULL CHECK (attempts >= 0),
  last_error     TEXT,
  created_at     TEXT    NOT NULL,
  started_at     TEXT,
  finished_at    TEXT,
  PRIMARY KEY (job, scheduled_date),
  CHECK ((status = 'skipped') = (attempts = 0)),
  CHECK (status = 'skipped' OR started_at IS NOT NULL)
) STRICT;
