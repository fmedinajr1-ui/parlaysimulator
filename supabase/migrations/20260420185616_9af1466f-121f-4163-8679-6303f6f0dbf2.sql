-- ============================================================================
-- TikTok Content Pipeline — Phase 1 Schema
-- All tables locked to admin role via has_role(auth.uid(), 'admin')
-- ============================================================================

-- ─── 1. Accounts (the personas / TikTok handles) ────────────────────────────
CREATE TABLE public.tiktok_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  persona_key TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  tiktok_handle TEXT,
  tone_description TEXT NOT NULL,
  hook_style TEXT NOT NULL CHECK (hook_style IN ('data_nerd','streetwise','confident_calm')),
  baseline_hashtags TEXT[] NOT NULL DEFAULT '{}',
  caption_template TEXT NOT NULL,
  elevenlabs_voice_id TEXT,
  heygen_avatar_id TEXT,
  status TEXT NOT NULL DEFAULT 'warming' CHECK (status IN ('active','warming','paused')),
  warmup_stage INT NOT NULL DEFAULT 0,
  posting_active BOOLEAN NOT NULL DEFAULT FALSE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.tiktok_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage tiktok accounts"
  ON public.tiktok_accounts
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ─── 2. Video scripts (queue) ───────────────────────────────────────────────
CREATE TABLE public.tiktok_video_scripts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID REFERENCES public.tiktok_accounts(id) ON DELETE SET NULL,
  target_persona_key TEXT NOT NULL,
  template TEXT NOT NULL CHECK (template IN ('pick_reveal','results_recap','data_insight')),
  hook JSONB NOT NULL DEFAULT '{}'::jsonb,
  beats JSONB NOT NULL DEFAULT '[]'::jsonb,
  cta JSONB NOT NULL DEFAULT '{}'::jsonb,
  caption_seed TEXT,
  hashtag_seed TEXT[] NOT NULL DEFAULT '{}',
  target_duration_sec NUMERIC(5,2),
  source JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_data JSONB,
  compliance_score INT NOT NULL DEFAULT 0,
  lint_transforms JSONB NOT NULL DEFAULT '[]'::jsonb,
  lint_warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','approved','rejected','rendered','posted','archived')),
  rejection_reason TEXT,
  reviewed_by UUID,
  reviewed_at TIMESTAMPTZ,
  telegram_message_id BIGINT,
  generation_round INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_tt_scripts_status ON public.tiktok_video_scripts (status, created_at DESC);
CREATE INDEX idx_tt_scripts_persona ON public.tiktok_video_scripts (target_persona_key, created_at DESC);

ALTER TABLE public.tiktok_video_scripts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage tiktok video scripts"
  ON public.tiktok_video_scripts
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ─── 3. Video renders (Phase 2 placeholder) ─────────────────────────────────
CREATE TABLE public.tiktok_video_renders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  script_id UUID NOT NULL REFERENCES public.tiktok_video_scripts(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','tts_running','avatar_running','broll_running','composing','safety_review','ready','failed','published')),
  artifacts JSONB NOT NULL DEFAULT '{}'::jsonb,
  error TEXT,
  cost_cents INT NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_tt_renders_script ON public.tiktok_video_renders (script_id);
CREATE INDEX idx_tt_renders_status ON public.tiktok_video_renders (status, created_at DESC);

ALTER TABLE public.tiktok_video_renders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage tiktok renders"
  ON public.tiktok_video_renders
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ─── 4. Posts (Phase 2 placeholder) ─────────────────────────────────────────
CREATE TABLE public.tiktok_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  script_id UUID REFERENCES public.tiktok_video_scripts(id) ON DELETE SET NULL,
  render_id UUID REFERENCES public.tiktok_video_renders(id) ON DELETE SET NULL,
  account_id UUID NOT NULL REFERENCES public.tiktok_accounts(id) ON DELETE CASCADE,
  scheduled_for TIMESTAMPTZ,
  posted_at TIMESTAMPTZ,
  tiktok_post_id TEXT,
  tiktok_url TEXT,
  caption TEXT,
  hashtags TEXT[] NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled','uploading','posted','failed','cancelled')),
  error TEXT,
  view_snapshots JSONB NOT NULL DEFAULT '[]'::jsonb,
  latest_views INT NOT NULL DEFAULT 0,
  latest_likes INT NOT NULL DEFAULT 0,
  latest_comments INT NOT NULL DEFAULT 0,
  latest_shares INT NOT NULL DEFAULT 0,
  latest_completion_rate NUMERIC(5,4),
  last_checked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_tt_posts_account ON public.tiktok_posts (account_id, posted_at DESC);
CREATE INDEX idx_tt_posts_status ON public.tiktok_posts (status, scheduled_for);

ALTER TABLE public.tiktok_posts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage tiktok posts"
  ON public.tiktok_posts
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ─── 5. Hook performance library ────────────────────────────────────────────
CREATE TABLE public.tiktok_hook_performance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  text TEXT NOT NULL,
  style TEXT NOT NULL CHECK (style IN ('data_nerd','streetwise','confident_calm')),
  template TEXT NOT NULL CHECK (template IN ('pick_reveal','results_recap','data_insight')),
  impressions INT NOT NULL DEFAULT 0,
  avg_completion_rate NUMERIC(5,4) NOT NULL DEFAULT 0.5,
  avg_views INT NOT NULL DEFAULT 0,
  total_completion_samples INT NOT NULL DEFAULT 0,
  origin TEXT NOT NULL DEFAULT 'seeded' CHECK (origin IN ('seeded','learned','generated','manual')),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_tt_hooks_style_template ON public.tiktok_hook_performance (style, template, active);

ALTER TABLE public.tiktok_hook_performance ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage tiktok hooks"
  ON public.tiktok_hook_performance
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ─── 6. Pipeline run logs ───────────────────────────────────────────────────
CREATE TABLE public.tiktok_pipeline_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_type TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('success','partial','failed','running')),
  message TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  duration_ms INT,
  scripts_generated INT NOT NULL DEFAULT 0,
  scripts_rejected INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_tt_logs_run_type ON public.tiktok_pipeline_logs (run_type, created_at DESC);

ALTER TABLE public.tiktok_pipeline_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read tiktok pipeline logs"
  ON public.tiktok_pipeline_logs
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins insert tiktok pipeline logs"
  ON public.tiktok_pipeline_logs
  FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ─── Updated-at triggers ────────────────────────────────────────────────────
CREATE TRIGGER trg_tt_accounts_updated
  BEFORE UPDATE ON public.tiktok_accounts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER trg_tt_scripts_updated
  BEFORE UPDATE ON public.tiktok_video_scripts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER trg_tt_renders_updated
  BEFORE UPDATE ON public.tiktok_video_renders
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER trg_tt_posts_updated
  BEFORE UPDATE ON public.tiktok_posts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER trg_tt_hooks_updated
  BEFORE UPDATE ON public.tiktok_hook_performance
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ─── Seed: 2 accounts ───────────────────────────────────────────────────────
INSERT INTO public.tiktok_accounts
  (persona_key, display_name, tiktok_handle, tone_description, hook_style, baseline_hashtags, caption_template, status, warmup_stage, posting_active)
VALUES
  ('the_analyst', 'The Analyst', NULL,
   'Calm, methodical, data-forward. Explains the WHY behind a number. Never hypes.',
   'data_nerd',
   ARRAY['#sportsanalytics','#dataoverfeelings','#sportsdata'],
   'Looked at the numbers on {script_gist}. The pattern surprised me. {cta}',
   'warming', 0, FALSE),
  ('the_edge', 'The Edge', NULL,
   'Street-smart, confident but not loud. Talks like your friend who reads box scores for fun.',
   'streetwise',
   ARRAY['#sportstok','#sportsdebate','#sportsedge'],
   '{script_gist} — the part nobody is talking about. {cta}',
   'warming', 0, FALSE);

-- ─── Seed: hook library (18 starter hooks) ──────────────────────────────────
INSERT INTO public.tiktok_hook_performance (text, style, template, origin, active) VALUES
  ('The numbers on {player} tonight are strange.', 'data_nerd', 'pick_reveal', 'seeded', TRUE),
  ('Three data points nobody is putting together.', 'data_nerd', 'pick_reveal', 'seeded', TRUE),
  ('There is a pattern in {player}''s last ten games.', 'data_nerd', 'pick_reveal', 'seeded', TRUE),
  ('The model flagged something we have to talk about.', 'data_nerd', 'pick_reveal', 'seeded', TRUE),
  ('{number} percent. That is the stat that matters here.', 'data_nerd', 'data_insight', 'seeded', TRUE),
  ('Here is the chart nobody on the broadcast will show you.', 'data_nerd', 'data_insight', 'seeded', TRUE),
  ('Someone is about to get cooked tonight.', 'streetwise', 'pick_reveal', 'seeded', TRUE),
  ('You are not ready for what this data is showing.', 'streetwise', 'pick_reveal', 'seeded', TRUE),
  ('The line on this one is wrong and I can prove it.', 'streetwise', 'pick_reveal', 'seeded', TRUE),
  ('Everybody is talking about the wrong player.', 'streetwise', 'pick_reveal', 'seeded', TRUE),
  ('Yesterday hurt. Here is the honest tally.', 'streetwise', 'results_recap', 'seeded', TRUE),
  ('We got one wrong. Here is what we learned.', 'streetwise', 'results_recap', 'seeded', TRUE),
  ('Watch this before tip-off.', 'confident_calm', 'pick_reveal', 'seeded', TRUE),
  ('One player. Three numbers. You will want to remember them.', 'confident_calm', 'pick_reveal', 'seeded', TRUE),
  ('A lot of people are missing the real story here.', 'confident_calm', 'pick_reveal', 'seeded', TRUE),
  ('This happens four times a season and it is happening tonight.', 'confident_calm', 'pick_reveal', 'seeded', TRUE),
  ('{count} reads yesterday. {winrate} percent landed. Here is the one that stung.', 'confident_calm', 'results_recap', 'seeded', TRUE),
  ('I want to show you something specific.', 'confident_calm', 'data_insight', 'seeded', TRUE);
