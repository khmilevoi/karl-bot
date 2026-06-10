BEGIN TRANSACTION;

CREATE TABLE audio_transcription_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_file_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  attempts INTEGER NOT NULL DEFAULT 0,
  available_at TEXT NOT NULL,
  locked_until TEXT,
  result_text TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_audio_transcription_jobs_pick
  ON audio_transcription_jobs(status, available_at, locked_until);

COMMIT;
