ALTER TABLE chat_configs ADD COLUMN interest_interval INTEGER NOT NULL DEFAULT 25;
ALTER TABLE users ADD COLUMN attitude TEXT;
ALTER TABLE messages DROP COLUMN is_active;
