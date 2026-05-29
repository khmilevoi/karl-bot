CREATE TABLE IF NOT EXISTS bot_personality_states (
  chat_id INTEGER PRIMARY KEY,
  identity_notes_json TEXT NOT NULL DEFAULT '[]',
  values_json TEXT NOT NULL DEFAULT '[]',
  speech_style_json TEXT NOT NULL DEFAULT '{}',
  social_habits_json TEXT NOT NULL DEFAULT '[]',
  recurring_themes_json TEXT NOT NULL DEFAULT '[]',
  last_updated_at TEXT NOT NULL,
  FOREIGN KEY (chat_id) REFERENCES chats(chat_id)
);

CREATE TABLE IF NOT EXISTS bot_political_states (
  chat_id INTEGER PRIMARY KEY,
  ideology_summary TEXT NOT NULL DEFAULT '',
  positions_json TEXT NOT NULL DEFAULT '[]',
  uncertainty_areas_json TEXT NOT NULL DEFAULT '[]',
  influence_history_json TEXT NOT NULL DEFAULT '[]',
  last_updated_at TEXT NOT NULL,
  FOREIGN KEY (chat_id) REFERENCES chats(chat_id)
);

CREATE TABLE IF NOT EXISTS bot_truths (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id INTEGER NOT NULL,
  text TEXT NOT NULL,
  source_message_ids_json TEXT NOT NULL DEFAULT '[]',
  confidence REAL NOT NULL DEFAULT 0,
  related_truth_ids_json TEXT NOT NULL DEFAULT '[]',
  contradicts_truth_ids_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'fresh',
  created_at TEXT NOT NULL,
  FOREIGN KEY (chat_id) REFERENCES chats(chat_id)
);

CREATE TABLE IF NOT EXISTS user_social_profiles (
  chat_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  username TEXT,
  affinity_score INTEGER NOT NULL DEFAULT 0,
  labels_json TEXT NOT NULL DEFAULT '[]',
  patterns_json TEXT NOT NULL DEFAULT '[]',
  grudges_json TEXT NOT NULL DEFAULT '[]',
  trust_level TEXT NOT NULL DEFAULT 'none',
  preferred_distance TEXT NOT NULL DEFAULT 'neutral',
  communication_style TEXT NOT NULL DEFAULT '',
  conflict_style TEXT NOT NULL DEFAULT '',
  preferred_tone TEXT NOT NULL DEFAULT '',
  interests_json TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL,
  PRIMARY KEY (chat_id, user_id),
  FOREIGN KEY (chat_id) REFERENCES chats(chat_id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS behavior_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id INTEGER NOT NULL,
  schema_version TEXT NOT NULL,
  gate_reason TEXT,
  gate_confidence REAL,
  gate_state_impact_risk TEXT,
  trigger_message_ids_json TEXT NOT NULL DEFAULT '[]',
  context_message_ids_json TEXT NOT NULL DEFAULT '[]',
  model_slot TEXT NOT NULL,
  selected_model TEXT NOT NULL,
  escalated INTEGER NOT NULL DEFAULT 0,
  escalation_reason TEXT,
  actions_json TEXT NOT NULL DEFAULT '[]',
  action_results_json TEXT NOT NULL DEFAULT '[]',
  state_patches_json TEXT NOT NULL DEFAULT '[]',
  patch_results_json TEXT NOT NULL DEFAULT '[]',
  confidence REAL NOT NULL DEFAULT 0,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  total_tokens INTEGER,
  latency_ms INTEGER,
  created_at TEXT NOT NULL,
  FOREIGN KEY (chat_id) REFERENCES chats(chat_id)
);

CREATE TABLE IF NOT EXISTS ai_error_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id INTEGER,
  source TEXT NOT NULL,
  severity TEXT NOT NULL,
  error_code TEXT NOT NULL,
  message TEXT NOT NULL,
  component TEXT NOT NULL,
  operation TEXT NOT NULL,
  input_ref_json TEXT,
  output_ref_json TEXT,
  stack_hash TEXT,
  fix_hint TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_behavior_events_chat ON behavior_events(chat_id, id);
CREATE INDEX IF NOT EXISTS idx_bot_truths_chat ON bot_truths(chat_id, status);
CREATE INDEX IF NOT EXISTS idx_ai_error_events_status ON ai_error_events(status, id);
