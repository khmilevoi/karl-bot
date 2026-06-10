PRAGMA foreign_keys=OFF;

BEGIN TRANSACTION;

DROP INDEX IF EXISTS idx_fact_check_findings_status_checked;
DROP INDEX IF EXISTS idx_fact_check_findings_author_checked;
DROP INDEX IF EXISTS idx_fact_check_findings_chat_checked;
DROP INDEX IF EXISTS idx_fact_check_findings_dedup;

CREATE TABLE fact_check_findings_without_notification_intent (
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

INSERT INTO fact_check_findings_without_notification_intent (
  id,
  run_id,
  chat_id,
  message_id,
  telegram_message_id,
  author_user_id,
  author_display_name,
  normalized_claim_key,
  claim_text,
  original_quote,
  corrected_fact,
  explanation,
  category,
  severity,
  status,
  confidence,
  source_policy,
  source_requirements_met,
  message_url,
  immediate_notified_at,
  digest_notified_at,
  notification_error,
  created_at,
  checked_at
)
SELECT
  id,
  run_id,
  chat_id,
  message_id,
  telegram_message_id,
  author_user_id,
  author_display_name,
  normalized_claim_key,
  claim_text,
  original_quote,
  corrected_fact,
  explanation,
  category,
  severity,
  status,
  confidence,
  source_policy,
  source_requirements_met,
  message_url,
  immediate_notified_at,
  digest_notified_at,
  notification_error,
  created_at,
  checked_at
FROM fact_check_findings;

DROP TABLE fact_check_findings;
ALTER TABLE fact_check_findings_without_notification_intent RENAME TO fact_check_findings;

CREATE UNIQUE INDEX idx_fact_check_findings_dedup
  ON fact_check_findings(message_id, normalized_claim_key);

CREATE INDEX idx_fact_check_findings_chat_checked
  ON fact_check_findings(chat_id, checked_at);

CREATE INDEX idx_fact_check_findings_author_checked
  ON fact_check_findings(author_user_id, checked_at);

CREATE INDEX idx_fact_check_findings_status_checked
  ON fact_check_findings(status, checked_at);

COMMIT;

PRAGMA foreign_keys=ON;
