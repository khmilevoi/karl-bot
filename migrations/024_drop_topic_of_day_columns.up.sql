BEGIN TRANSACTION;

CREATE TABLE chat_configs_without_topic_of_day (
  chat_id INTEGER PRIMARY KEY,
  history_limit INTEGER NOT NULL DEFAULT 50
);

INSERT INTO chat_configs_without_topic_of_day (chat_id, history_limit)
SELECT chat_id, history_limit
FROM chat_configs;

DROP TABLE chat_configs;
ALTER TABLE chat_configs_without_topic_of_day RENAME TO chat_configs;

COMMIT;
