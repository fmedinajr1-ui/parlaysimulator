
-- Add hedge notification columns to notification_preferences
ALTER TABLE public.notification_preferences 
  ADD COLUMN IF NOT EXISTS push_hedge_alerts boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS email_hedge_summary boolean NOT NULL DEFAULT false;

-- Create customer hedge notifications table for in-app feed
CREATE TABLE public.customer_hedge_notifications (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  player_name TEXT NOT NULL,
  prop_type TEXT NOT NULL,
  line NUMERIC NOT NULL,
  side TEXT NOT NULL,
  hedge_action TEXT NOT NULL,
  status_transition TEXT,
  current_value NUMERIC,
  projected_final NUMERIC,
  message TEXT NOT NULL,
  read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.customer_hedge_notifications ENABLE ROW LEVEL SECURITY;

-- Users can read their own notifications
CREATE POLICY "Users can read own hedge notifications"
  ON public.customer_hedge_notifications
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Users can update (mark as read) their own notifications
CREATE POLICY "Users can update own hedge notifications"
  ON public.customer_hedge_notifications
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid());

-- Service role can insert (from edge functions)
CREATE POLICY "Service role can insert hedge notifications"
  ON public.customer_hedge_notifications
  FOR INSERT
  TO service_role
  WITH CHECK (true);

-- Index for fast user lookups
CREATE INDEX idx_customer_hedge_notifications_user_id 
  ON public.customer_hedge_notifications (user_id, created_at DESC);

CREATE INDEX idx_customer_hedge_notifications_unread 
  ON public.customer_hedge_notifications (user_id, read) WHERE read = false;
