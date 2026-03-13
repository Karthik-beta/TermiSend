\pset footer off
\pset format unaligned
\pset fieldsep |

SELECT 'total_rows' AS metric, COUNT(*)::text AS value
FROM ses_event_tracking
UNION ALL
SELECT 'rows_with_send_log' AS metric, COUNT(*)::text AS value
FROM ses_event_tracking
WHERE send_log_id IS NOT NULL
UNION ALL
SELECT 'rows_without_send_log' AS metric, COUNT(*)::text AS value
FROM ses_event_tracking
WHERE send_log_id IS NULL
UNION ALL
SELECT 'delivery_rows' AS metric, COUNT(*)::text AS value
FROM ses_event_tracking
WHERE event_type = 'Delivery'
UNION ALL
SELECT 'bounce_rows' AS metric, COUNT(*)::text AS value
FROM ses_event_tracking
WHERE event_type = 'Bounce';

SELECT
  event_type,
  COALESCE(recipient_email, '-') AS recipient_email,
  COALESCE(ses_message_id, '-') AS ses_message_id,
  COALESCE(send_log_id::text, '-') AS send_log_id,
  to_char(occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS occurred_at_utc
FROM ses_event_tracking
ORDER BY processed_at DESC
LIMIT 10;
