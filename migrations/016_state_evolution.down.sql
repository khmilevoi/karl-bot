DROP INDEX IF EXISTS idx_bot_personality_signals_chat;
ALTER TABLE bot_political_states DROP COLUMN compass_json;
DROP TABLE IF EXISTS user_political_profiles;
DROP TABLE IF EXISTS state_evolution_cursors;
DROP TABLE IF EXISTS bot_personality_signals;
