BEGIN TRANSACTION;

DROP INDEX IF EXISTS idx_audio_transcription_jobs_pick;
DROP TABLE IF EXISTS audio_transcription_jobs;

COMMIT;
