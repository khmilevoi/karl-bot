BEGIN TRANSACTION;

ALTER TABLE chats ADD COLUMN username TEXT;

CREATE TABLE fact_check_windows (
  chat_id INTEGER PRIMARY KEY,
  last_checked_message_id INTEGER NOT NULL DEFAULT 0,
  last_checked_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE fact_check_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id INTEGER NOT NULL,
  run_type TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  message_from_id INTEGER,
  message_to_id INTEGER,
  extractor_model TEXT,
  verifier_model TEXT,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  total_tokens INTEGER,
  latency_ms INTEGER,
  error_message TEXT,
  request_json TEXT,
  response_json TEXT
);

CREATE TABLE fact_check_findings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL,
  chat_id INTEGER NOT NULL,
  message_id INTEGER NOT NULL,
  telegram_message_id INTEGER,
  author_user_id INTEGER,
  author_display_name TEXT NOT NULL,
  normalized_claim_key TEXT NOT NULL,
  claim_text TEXT NOT NULL,
  original_quote TEXT NOT NULL,
  corrected_fact TEXT NOT NULL,
  explanation TEXT NOT NULL,
  category TEXT NOT NULL,
  severity TEXT NOT NULL,
  status TEXT NOT NULL,
  confidence REAL NOT NULL,
  source_policy TEXT NOT NULL,
  source_requirements_met INTEGER NOT NULL,
  message_url TEXT,
  immediate_notified_at TEXT,
  digest_notified_at TEXT,
  notification_error TEXT,
  created_at TEXT NOT NULL,
  checked_at TEXT NOT NULL,
  FOREIGN KEY (run_id) REFERENCES fact_check_runs(id),
  FOREIGN KEY (message_id) REFERENCES messages(id)
);

CREATE TABLE fact_check_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  finding_id INTEGER NOT NULL,
  url TEXT NOT NULL,
  title TEXT NOT NULL,
  publisher TEXT,
  snippet TEXT NOT NULL,
  reliability TEXT NOT NULL,
  retrieved_at TEXT NOT NULL,
  FOREIGN KEY (finding_id) REFERENCES fact_check_findings(id)
);

CREATE UNIQUE INDEX idx_fact_check_findings_dedup
  ON fact_check_findings(message_id, normalized_claim_key);

CREATE INDEX idx_fact_check_findings_chat_checked
  ON fact_check_findings(chat_id, checked_at);

CREATE INDEX idx_fact_check_findings_author_checked
  ON fact_check_findings(author_user_id, checked_at);

CREATE INDEX idx_fact_check_findings_status_checked
  ON fact_check_findings(status, checked_at);

CREATE INDEX idx_fact_check_sources_finding
  ON fact_check_sources(finding_id);

COMMIT;
