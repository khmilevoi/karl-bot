BEGIN TRANSACTION;

DROP INDEX IF EXISTS idx_fact_check_sources_finding;
DROP INDEX IF EXISTS idx_fact_check_findings_status_checked;
DROP INDEX IF EXISTS idx_fact_check_findings_author_checked;
DROP INDEX IF EXISTS idx_fact_check_findings_chat_checked;
DROP INDEX IF EXISTS idx_fact_check_findings_dedup;
DROP TABLE IF EXISTS fact_check_sources;
DROP TABLE IF EXISTS fact_check_findings;
DROP TABLE IF EXISTS fact_check_runs;
DROP TABLE IF EXISTS fact_check_windows;
ALTER TABLE chats DROP COLUMN username;

COMMIT;
