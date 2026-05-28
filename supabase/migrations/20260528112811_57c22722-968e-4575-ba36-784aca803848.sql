
-- Robust accuracy ↔ alerts join: a view that matches on the full composite key
-- (event_id + player_name + prop_type) since both inserters now write the
-- composite event_id format `<gameHash>_<propType>_<Player_With_Underscores>`.
-- Legacy bare-event_id accuracy rows (pre-composite era) are excluded — they
-- have no surviving alert rows to match against anyway (verified: 0/4389).

CREATE INDEX IF NOT EXISTS idx_fpa_composite_key
  ON public.fanduel_prediction_accuracy (event_id, player_name, prop_type);

CREATE INDEX IF NOT EXISTS idx_fpalerts_composite_key
  ON public.fanduel_prediction_alerts (event_id, player_name, prop_type);

CREATE OR REPLACE VIEW public.v_alert_accuracy AS
SELECT
  al.id                AS alert_id,
  al.event_id          AS event_id,
  al.player_name,
  al.prop_type,
  al.sport,
  al.signal_type,
  al.prediction        AS alert_prediction,
  al.confidence        AS alert_confidence,
  al.metadata          AS alert_metadata,
  al.created_at        AS alert_created_at,
  al.settled_at        AS alert_settled_at,
  al.was_correct       AS alert_was_correct,
  al.actual_outcome    AS alert_actual_outcome,
  al.contrarian_flip_applied,
  acc.id               AS accuracy_id,
  acc.predicted_direction,
  acc.was_correct      AS accuracy_was_correct,
  acc.actual_outcome   AS accuracy_actual_outcome,
  acc.edge_at_signal,
  acc.confidence_at_signal,
  acc.line_at_alert,
  acc.closing_line,
  acc.line_movement_after_alert,
  acc.was_trap,
  acc.trap_type,
  acc.recommendation_status,
  acc.verified_at,
  acc.signal_factors
FROM public.fanduel_prediction_alerts al
LEFT JOIN public.fanduel_prediction_accuracy acc
  ON acc.event_id    = al.event_id
 AND acc.player_name = al.player_name
 AND acc.prop_type   = al.prop_type
 AND acc.signal_type = al.signal_type;

GRANT SELECT ON public.v_alert_accuracy TO authenticated, service_role;
