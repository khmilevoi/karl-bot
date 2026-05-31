CREATE TABLE IF NOT EXISTS bot_personality_signals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id INTEGER NOT NULL,
  area TEXT NOT NULL,
  polarity TEXT NOT NULL,
  text TEXT NOT NULL,
  evidence_message_ids_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  FOREIGN KEY (chat_id) REFERENCES chats(chat_id)
);

CREATE TABLE IF NOT EXISTS state_evolution_cursors (
  chat_id INTEGER PRIMARY KEY,
  last_event_id INTEGER NOT NULL DEFAULT 0,
  last_run_at TEXT,
  FOREIGN KEY (chat_id) REFERENCES chats(chat_id)
);

CREATE TABLE IF NOT EXISTS user_political_profiles (
  chat_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  notes_json TEXT NOT NULL DEFAULT '[]',
  compass_json TEXT NOT NULL DEFAULT '{"economic":0,"social":0,"economicConfidence":0,"socialConfidence":0}',
  updated_at TEXT NOT NULL,
  PRIMARY KEY (chat_id, user_id),
  FOREIGN KEY (chat_id) REFERENCES chats(chat_id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

ALTER TABLE bot_political_states ADD COLUMN compass_json TEXT NOT NULL DEFAULT '{"economic":0,"social":0,"economicConfidence":0,"socialConfidence":0}';

CREATE INDEX IF NOT EXISTS idx_bot_personality_signals_chat ON bot_personality_signals(chat_id, id);
