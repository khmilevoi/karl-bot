BEGIN TRANSACTION;

ALTER TABLE messages ADD COLUMN source_type TEXT NOT NULL DEFAULT 'text';
ALTER TABLE messages ADD COLUMN processing_status TEXT NOT NULL DEFAULT 'ready';

CREATE TABLE voice_transcription_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id INTEGER NOT NULL,
  chat_id INTEGER NOT NULL,
  telegram_message_id INTEGER NOT NULL,
  telegram_file_id TEXT NOT NULL,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  available_at TEXT NOT NULL,
  locked_until TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (message_id) REFERENCES messages(id),
  FOREIGN KEY (chat_id) REFERENCES chats(chat_id)
);

CREATE INDEX idx_voice_jobs_pick
  ON voice_transcription_jobs(status, available_at, locked_until);

COMMIT;
