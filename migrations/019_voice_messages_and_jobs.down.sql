BEGIN TRANSACTION;

DROP INDEX IF EXISTS idx_voice_jobs_pick;
DROP TABLE IF EXISTS voice_transcription_jobs;

CREATE TABLE messages_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id INTEGER NOT NULL,
  message_id INTEGER,
  role TEXT,
  content TEXT,
  user_id INTEGER NOT NULL,
  reply_text TEXT,
  reply_username TEXT,
  quote_text TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (chat_id) REFERENCES chats(chat_id)
);

INSERT INTO messages_new (
  id,
  chat_id,
  message_id,
  role,
  content,
  user_id,
  reply_text,
  reply_username,
  quote_text,
  is_active
)
SELECT
  id,
  chat_id,
  message_id,
  role,
  content,
  user_id,
  reply_text,
  reply_username,
  quote_text,
  is_active
FROM messages;

DROP TABLE messages;
ALTER TABLE messages_new RENAME TO messages;

COMMIT;
