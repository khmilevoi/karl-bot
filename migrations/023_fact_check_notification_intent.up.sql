BEGIN TRANSACTION;

ALTER TABLE fact_check_findings
  ADD COLUMN should_notify_immediately INTEGER NOT NULL DEFAULT 0;

COMMIT;
