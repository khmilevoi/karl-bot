BEGIN TRANSACTION;

ALTER TABLE messages DROP COLUMN reply_to_message_id;
ALTER TABLE messages DROP COLUMN reply_to_user_id;

COMMIT;
