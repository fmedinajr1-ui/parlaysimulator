// Shared TikTok pipeline types — ported from external repo, adapted for Lovable Cloud.

export type VideoTemplate = 'pick_reveal' | 'results_recap' | 'data_insight';
export type HookStyle = 'data_nerd' | 'streetwise' | 'confident_calm';

export interface ScriptBeat {
  index: number;
  vo_text: string;
  duration_est_sec: number;
  visual: 'avatar' | 'avatar_with_lower_third' | 'broll' | 'stat_card';
  on_screen_text?: string;
  broll_query?: string;
  stat_card_data?: StatCardData;
}

export interface StatCardData {
  title: string;
  rows: Array<{ label: string; value: string; highlight?: boolean }>;
  footer?: string;
}

export interface ScriptHook {
  vo_text: string;
  visual_style: 'high_energy' | 'calm_authority' | 'curious';
  hook_source_id?: string;
}

export interface ScriptCTA {
  vo_text: string;
  on_screen_text: string;
}

export interface VideoScript {
  id: string;
  template: VideoTemplate;
  target_persona_key: string;
  account_id?: string;
  target_duration_sec: number;
  hook: ScriptHook;
  beats: ScriptBeat[];
  cta: ScriptCTA;
  caption_seed: string;
  hashtag_seed: string[];
  source: { pick_ids?: string[]; insight_topic?: string; recap_date?: string };
  source_data?: any;
  compliance_score: number;
  lint_transforms: Array<{ from: string; to: string; beat_index: number }>;
  lint_warnings?: Array<{ text: string; beat_index: number; reason: string }>;
}

export interface TiktokAccount {
  id: string;
  persona_key: string;
  display_name: string;
  tiktok_handle: string | null;
  tone_description: string;
  hook_style: HookStyle;
  baseline_hashtags: string[];
  caption_template: string;
  status: 'active' | 'warming' | 'paused';
  warmup_stage: number;
  posting_active: boolean;
}

export interface HookEntry {
  id: string;
  text: string;
  style: HookStyle;
  template: VideoTemplate;
  impressions: number;
  avg_completion_rate: number;
  avg_views: number;
  origin: 'seeded' | 'learned' | 'generated' | 'manual';
  active: boolean;
}
