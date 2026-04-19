CREATE TABLE IF NOT EXISTS bot_day_state (
    date               DATE PRIMARY KEY,
    phases_completed   TEXT[] NOT NULL DEFAULT '{}',
    slate_size         INTEGER,
    picks_released     INTEGER NOT NULL DEFAULT 0,
    day_started_at     TIMESTAMPTZ,
    day_notes          JSONB NOT NULL DEFAULT '{}',
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE bot_day_state IS
    'Tracks which narrative phases have fired each day and stores free-form day-notes used for callbacks in later messages.';

CREATE TABLE IF NOT EXISTS bot_message_log (
    id                    BIGSERIAL PRIMARY KEY,
    chat_id               TEXT NOT NULL,
    telegram_message_id   BIGINT,
    text_preview          TEXT NOT NULL,
    narrative_phase       TEXT,
    reference_key         TEXT,
    success               BOOLEAN NOT NULL,
    error                 TEXT,
    sent_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_message_log_reference_key
    ON bot_message_log (reference_key, sent_at DESC)
    WHERE success = true AND reference_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_message_log_phase_sent_at
    ON bot_message_log (narrative_phase, sent_at DESC)
    WHERE success = true;

COMMENT ON TABLE bot_message_log IS
    'Every outbound Telegram message. Used by the orchestrator for callbacks to earlier messages and for audit.';

CREATE TABLE IF NOT EXISTS bot_daily_picks (
    id                  TEXT PRIMARY KEY,
    pick_date           DATE NOT NULL,
    player_name         TEXT NOT NULL,
    team                TEXT,
    opponent            TEXT,
    sport               TEXT NOT NULL,
    prop_type           TEXT NOT NULL,
    line                NUMERIC NOT NULL,
    side                TEXT NOT NULL CHECK (side IN ('over', 'under')),
    american_odds       INTEGER,
    confidence          NUMERIC NOT NULL CHECK (confidence >= 0 AND confidence <= 100),
    edge_pct            NUMERIC,
    tier                TEXT,
    reasoning           JSONB NOT NULL,
    recency             JSONB,
    generator           TEXT NOT NULL,
    game_id             TEXT,
    game_start_utc      TIMESTAMPTZ,
    status              TEXT NOT NULL DEFAULT 'locked'
                         CHECK (status IN ('locked', 'released', 'voided', 'settled')),
    actual_value        NUMERIC,
    outcome             TEXT CHECK (outcome IN ('hit', 'miss', 'push', 'void')),
    parlay_id           TEXT,
    generated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_picks_date_status
    ON bot_daily_picks (pick_date, status);

CREATE INDEX IF NOT EXISTS idx_picks_date_confidence
    ON bot_daily_picks (pick_date, confidence DESC);

CREATE INDEX IF NOT EXISTS idx_picks_game_id
    ON bot_daily_picks (game_id) WHERE game_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_picks_parlay_id
    ON bot_daily_picks (parlay_id) WHERE parlay_id IS NOT NULL;

COMMENT ON TABLE bot_daily_picks IS
    'Canonical pick table. Every generator writes Pick objects here. The orchestrator releases them in the pick_drops phase.';

ALTER TABLE bot_day_state     ENABLE ROW LEVEL SECURITY;
ALTER TABLE bot_message_log   ENABLE ROW LEVEL SECURITY;
ALTER TABLE bot_daily_picks   ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE VIEW v_recent_messages_by_key AS
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

COMMENT ON VIEW v_recent_messages_by_key IS
    'Fast-lookup of the most recent message per reference_key, used by voice.loadCallback().';