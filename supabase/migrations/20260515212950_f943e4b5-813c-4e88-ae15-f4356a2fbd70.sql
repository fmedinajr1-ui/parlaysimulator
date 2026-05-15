ALTER TABLE public.tiktok_hook_performance DROP CONSTRAINT IF EXISTS tiktok_hook_performance_template_check;
ALTER TABLE public.tiktok_hook_performance ADD CONSTRAINT tiktok_hook_performance_template_check
  CHECK (template = ANY (ARRAY['pick_reveal'::text, 'results_recap'::text, 'data_insight'::text, 'streamer_promo'::text]));

ALTER TABLE public.tiktok_video_scripts DROP CONSTRAINT IF EXISTS tiktok_video_scripts_template_check;
ALTER TABLE public.tiktok_video_scripts ADD CONSTRAINT tiktok_video_scripts_template_check
  CHECK (template = ANY (ARRAY['pick_reveal'::text, 'results_recap'::text, 'data_insight'::text, 'streamer_promo'::text]));