ALTER TABLE messages ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1;
ALTER TABLE users DROP COLUMN attitude;
ALTER TABLE chat_configs DROP COLUMN interest_interval;
