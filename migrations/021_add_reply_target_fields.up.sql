BEGIN TRANSACTION;

ALTER TABLE messages ADD COLUMN reply_to_message_id INTEGER;
ALTER TABLE messages ADD COLUMN reply_to_user_id INTEGER;

COMMIT;
