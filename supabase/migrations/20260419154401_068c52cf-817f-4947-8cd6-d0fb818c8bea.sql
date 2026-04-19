DROP VIEW IF EXISTS v_recent_messages_by_key;
CREATE VIEW v_recent_messages_by_key
WITH (security_invoker = true) AS
SELECT DISTINCT ON (reference_key)
    reference_key,
    chat_id,
    text_preview,
    narrative_phase,
    sent_at
FROM bot_message_log
WHERE success = true AND reference_key IS NOT NULL
  AND sent_at > NOW() - INTERVAL '48 hours'
ORDER BY reference_key, sent_at DESC;