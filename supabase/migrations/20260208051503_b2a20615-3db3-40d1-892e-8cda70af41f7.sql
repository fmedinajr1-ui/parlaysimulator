-- Bot notification settings table
CREATE TABLE bot_notification_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id),
  
  -- Telegram config
  telegram_chat_id text,
  telegram_enabled boolean DEFAULT true,
  
  -- Notification toggles
  notify_parlays_generated boolean DEFAULT true,
  notify_settlement boolean DEFAULT true,
  notify_activation_ready boolean DEFAULT true,
  notify_weight_changes boolean DEFAULT false,
  notify_strategy_updates boolean DEFAULT false,
  
  -- Quiet hours (ET timezone)
  quiet_start_hour int DEFAULT 23,
  quiet_end_hour int DEFAULT 7,
  
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Bot activity log table for real-time feed
CREATE TABLE bot_activity_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz DEFAULT now(),
  event_type text NOT NULL,
  message text NOT NULL,
  metadata jsonb,
  severity text DEFAULT 'info'
);

-- Index for fast activity feed queries
CREATE INDEX idx_bot_activity_created ON bot_activity_log(created_at DESC);

-- Enable RLS
ALTER TABLE bot_notification_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE bot_activity_log ENABLE ROW LEVEL SECURITY;

-- RLS policies for notification settings
CREATE POLICY "Users can view their own notification settings"
ON bot_notification_settings FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own notification settings"
ON bot_notification_settings FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own notification settings"
ON bot_notification_settings FOR UPDATE
USING (auth.uid() = user_id);

-- RLS policies for activity log (public read, service role write)
CREATE POLICY "Anyone can view bot activity log"
ON bot_activity_log FOR SELECT
USING (true);

-- Enable realtime for activity log
ALTER PUBLICATION supabase_realtime ADD TABLE bot_activity_log;