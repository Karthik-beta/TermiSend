\pset footer off
\pset format unaligned
\pset fieldsep |

\if :{?window_days}
\else
\set window_days 30
\endif

\if :{?sample_limit}
\else
\set sample_limit 10
\endif

WITH base AS (
  SELECT
    sl.id,
    sl.status,
    sl.message_id,
    c.email,
    sl.created_at,
    sl.sent_at,
    sl.delivery_confirmed_at
  FROM send_logs sl
  JOIN contacts c ON c.id = sl.contact_id
  WHERE sl.created_at >= NOW() - (:'window_days' || ' days')::interval
    AND sl.mode = 'production'
),
event_summary AS (
  SELECT
    setr.send_log_id,
    MAX(setr.occurred_at) FILTER (WHERE setr.event_type = 'Send') AS send_event_at,
    MAX(setr.occurred_at) FILTER (WHERE setr.event_type = 'Delivery') AS delivery_event_at,
    MAX(setr.occurred_at) FILTER (WHERE setr.event_type = 'Bounce') AS bounce_event_at,
    MAX(setr.occurred_at) FILTER (WHERE setr.event_type = 'Complaint') AS complaint_event_at,
    MAX(setr.occurred_at) FILTER (WHERE setr.event_type = 'Reject') AS reject_event_at,
    MAX(setr.occurred_at) FILTER (WHERE setr.event_type = 'RenderingFailure') AS rendering_failure_at,
    string_agg(DISTINCT setr.event_type, ',' ORDER BY setr.event_type) AS event_types
  FROM ses_event_tracking setr
  JOIN base b ON b.id = setr.send_log_id
  GROUP BY setr.send_log_id
)
SELECT
  'SUMMARY' AS section,
  COUNT(*)::text AS total_sends,
  COUNT(*) FILTER (WHERE b.message_id IS NOT NULL)::text AS with_message_id,
  COUNT(*) FILTER (WHERE b.status = 'sent')::text AS status_sent,
  COUNT(*) FILTER (WHERE b.status = 'delivered')::text AS status_delivered,
  COUNT(*) FILTER (WHERE b.status = 'bounced')::text AS status_bounced,
  COUNT(*) FILTER (WHERE b.status = 'complained')::text AS status_complained,
  COUNT(*) FILTER (WHERE es.send_event_at IS NOT NULL)::text AS send_events,
  COUNT(*) FILTER (WHERE es.delivery_event_at IS NOT NULL)::text AS delivery_events,
  COUNT(*) FILTER (WHERE es.bounce_event_at IS NOT NULL)::text AS bounce_events,
  COUNT(*) FILTER (WHERE es.complaint_event_at IS NOT NULL)::text AS complaint_events,
  COUNT(*) FILTER (WHERE es.reject_event_at IS NOT NULL)::text AS reject_events,
  COUNT(*) FILTER (WHERE es.rendering_failure_at IS NOT NULL)::text AS rendering_failure_events,
  COUNT(*) FILTER (
    WHERE b.message_id IS NOT NULL
      AND es.send_event_at IS NOT NULL
      AND es.delivery_event_at IS NULL
      AND es.bounce_event_at IS NULL
      AND es.complaint_event_at IS NULL
      AND es.reject_event_at IS NULL
      AND es.rendering_failure_at IS NULL
  )::text AS accepted_no_outcome
FROM base b
LEFT JOIN event_summary es ON es.send_log_id = b.id;

WITH base AS (
  SELECT
    sl.id,
    sl.status,
    sl.message_id,
    c.email,
    sl.created_at,
    sl.sent_at,
    sl.delivery_confirmed_at
  FROM send_logs sl
  JOIN contacts c ON c.id = sl.contact_id
  WHERE sl.created_at >= NOW() - (:'window_days' || ' days')::interval
    AND sl.mode = 'production'
)
SELECT
  'ACCEPTED_SAMPLE' AS section,
  b.email,
  b.status,
  COALESCE(b.message_id, '-') AS message_id,
  to_char(b.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at_utc,
  COALESCE(to_char(b.sent_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), '-') AS sent_at_utc
FROM base b
WHERE b.message_id IS NOT NULL
ORDER BY b.created_at DESC
LIMIT :'sample_limit';

WITH base AS (
  SELECT
    sl.id,
    sl.status,
    sl.message_id,
    c.email,
    sl.created_at,
    sl.sent_at,
    sl.delivery_confirmed_at
  FROM send_logs sl
  JOIN contacts c ON c.id = sl.contact_id
  WHERE sl.created_at >= NOW() - (:'window_days' || ' days')::interval
    AND sl.mode = 'production'
),
event_summary AS (
  SELECT
    setr.send_log_id,
    MAX(setr.occurred_at) FILTER (WHERE setr.event_type = 'Send') AS send_event_at,
    MAX(setr.occurred_at) FILTER (WHERE setr.event_type = 'Delivery') AS delivery_event_at,
    MAX(setr.occurred_at) FILTER (WHERE setr.event_type = 'Bounce') AS bounce_event_at,
    MAX(setr.occurred_at) FILTER (WHERE setr.event_type = 'Complaint') AS complaint_event_at,
    MAX(setr.occurred_at) FILTER (WHERE setr.event_type = 'Reject') AS reject_event_at,
    MAX(setr.occurred_at) FILTER (WHERE setr.event_type = 'RenderingFailure') AS rendering_failure_at,
    string_agg(DISTINCT setr.event_type, ',' ORDER BY setr.event_type) AS event_types
  FROM ses_event_tracking setr
  JOIN base b ON b.id = setr.send_log_id
  GROUP BY setr.send_log_id
)
SELECT
  'POSSIBLE_SUPPRESSION' AS section,
  b.email,
  b.status,
  COALESCE(b.message_id, '-') AS message_id,
  to_char(b.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at_utc,
  COALESCE(to_char(es.send_event_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), '-') AS send_event_utc,
  COALESCE(to_char(es.delivery_event_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), '-') AS delivery_event_utc,
  COALESCE(to_char(es.bounce_event_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), '-') AS bounce_event_utc,
  COALESCE(to_char(es.complaint_event_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), '-') AS complaint_event_utc,
  COALESCE(es.event_types, '-') AS event_types
FROM base b
LEFT JOIN event_summary es ON es.send_log_id = b.id
WHERE b.message_id IS NOT NULL
  AND es.send_event_at IS NOT NULL
  AND es.delivery_event_at IS NULL
  AND es.bounce_event_at IS NULL
  AND es.complaint_event_at IS NULL
  AND es.reject_event_at IS NULL
  AND es.rendering_failure_at IS NULL
ORDER BY b.created_at DESC
LIMIT :'sample_limit';

WITH base AS (
  SELECT
    sl.id,
    sl.status,
    sl.message_id,
    c.email,
    sl.created_at,
    sl.sent_at,
    sl.delivery_confirmed_at
  FROM send_logs sl
  JOIN contacts c ON c.id = sl.contact_id
  WHERE sl.created_at >= NOW() - (:'window_days' || ' days')::interval
    AND sl.mode = 'production'
),
event_summary AS (
  SELECT
    setr.send_log_id,
    MAX(setr.occurred_at) FILTER (WHERE setr.event_type = 'Send') AS send_event_at,
    MAX(setr.occurred_at) FILTER (WHERE setr.event_type = 'Delivery') AS delivery_event_at,
    string_agg(DISTINCT setr.event_type, ',' ORDER BY setr.event_type) AS event_types
  FROM ses_event_tracking setr
  JOIN base b ON b.id = setr.send_log_id
  GROUP BY setr.send_log_id
)
SELECT
  'DELIVERED_SAMPLE' AS section,
  b.email,
  b.status,
  COALESCE(b.message_id, '-') AS message_id,
  to_char(b.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at_utc,
  COALESCE(to_char(es.send_event_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), '-') AS send_event_utc,
  COALESCE(to_char(es.delivery_event_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), '-') AS delivery_event_utc,
  COALESCE(es.event_types, '-') AS event_types
FROM base b
LEFT JOIN event_summary es ON es.send_log_id = b.id
WHERE es.delivery_event_at IS NOT NULL
   OR b.delivery_confirmed_at IS NOT NULL
   OR b.status = 'delivered'
ORDER BY COALESCE(es.delivery_event_at, b.delivery_confirmed_at, b.created_at) DESC
LIMIT :'sample_limit';
