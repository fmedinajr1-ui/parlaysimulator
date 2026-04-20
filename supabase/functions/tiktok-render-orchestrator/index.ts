// ──────────────────────────────────────────────────────────────────────────────
// TikTok Render Orchestrator
// ──────────────────────────────────────────────────────────────────────────────
// Phase 2 of the TikTok pipeline. Picks up an APPROVED script and walks it
// through the full render chain:
//
//   1. ElevenLabs  → narration MP3 + word-level timings
//   2. Storage     → upload audio so HeyGen + worker can fetch it
//   3. HeyGen      → talking-head avatar video (audio-driven, lipsync only)
//   4. Pexels      → b-roll clips for each beat that needs broll
//   5. Worker call → POST job to external Remotion worker (compositing)
//
// The actual Remotion compositing runs in the external `worker/` Python+Node
// service because Remotion needs ffmpeg + Chromium and cannot run in Deno
// edge functions. The worker reports back via `tiktok-render-callback`.
//
// Body shape:
//   { script_id: string }   → renders one approved script
//   {}                       → picks up the next approved script in the queue
//
// All steps update `tiktok_video_renders.step` so the admin UI can show
// progress in real-time.
// ──────────────────────────────────────────────────────────────────────────────

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const STORAGE_BUCKET = 'tiktok-renders';

// Voice IDs per persona — admin can change these later in the accounts table.
// Defaults are decent ElevenLabs voices for confident narration.
const DEFAULT_VOICE_BY_HOOK_STYLE: Record<string, string> = {
  data_nerd:       'JBFqnCBsd6RMkjVDRZzb', // George — calm, measured
  streetwise:      'nPczCjzI2devNBz1zQrb', // Brian  — natural, energetic
  confident_calm:  'cjVigY5qzO86Huf0OWal', // Eric   — confident
};

// HeyGen avatar IDs — admin updates these per account once HeyGen is set up.
// Falls back to a single shared avatar if not configured.
const FALLBACK_HEYGEN_AVATAR = Deno.env.get('HEYGEN_DEFAULT_AVATAR_ID') || 'Daisy-inskirt-20220818';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE);
  const startedAt = Date.now();
  let scriptId: string | null = null;
  let renderId: string | null = null;

  try {
    const body = await req.json().catch(() => ({}));
    scriptId = body.script_id ?? null;

    // ── 1. Pick a script ──────────────────────────────────────────────────
    let script: any;
    if (scriptId) {
      const { data, error } = await sb.from('tiktok_video_scripts').select('*').eq('id', scriptId).maybeSingle();
      if (error || !data) throw new Error(`Script ${scriptId} not found`);
      if (data.status !== 'approved') throw new Error(`Script must be approved (current: ${data.status})`);
      script = data;
    } else {
      const { data } = await sb.from('tiktok_video_scripts')
        .select('*').eq('status', 'approved')
        .order('created_at', { ascending: true }).limit(1).maybeSingle();
      if (!data) return jsonResp({ success: true, message: 'No approved scripts in queue.' });
      script = data;
      scriptId = data.id;
    }

    // ── 2. Create render row + mark script as rendering ──────────────────
    const { data: account } = await sb.from('tiktok_accounts')
      .select('*').eq('persona_key', script.target_persona_key).maybeSingle();

    const { data: render, error: renderErr } = await sb.from('tiktok_video_renders')
      .insert({
        script_id: script.id,
        account_id: account?.id ?? null,
        status: 'rendering',
        step: 'tts',
        step_started_at: new Date().toISOString(),
        render_provider: 'remotion_worker',
      })
      .select().single();
    if (renderErr) throw renderErr;
    renderId = render.id;

    await sb.from('tiktok_video_scripts')
      .update({ status: 'rendering', render_started_at: new Date().toISOString() })
      .eq('id', script.id);

    // ── 3. ElevenLabs narration ──────────────────────────────────────────
    await markStep(sb, renderId, 'tts');
    const fullVoText = buildVoiceoverText(script);
    const voiceId = (account?.elevenlabs_voice_id as string)
      || DEFAULT_VOICE_BY_HOOK_STYLE[account?.hook_style as string]
      || DEFAULT_VOICE_BY_HOOK_STYLE.confident_calm;

    const { audio, timings, durationSec } = await synthesizeVoice(fullVoText, voiceId);
    const audioPath = `audio/${script.id}.mp3`;
    const audioUrl = await uploadAndSign(sb, audioPath, audio, 'audio/mpeg');

    await sb.from('tiktok_video_renders').update({
      audio_url: audioUrl,
      audio_duration_sec: durationSec,
      audio_timings: timings,
      cost_breakdown: { elevenlabs_chars: fullVoText.length },
    }).eq('id', renderId);

    // ── 4. HeyGen avatar render ──────────────────────────────────────────
    await markStep(sb, renderId, 'avatar');
    const avatarId = (account?.heygen_avatar_id as string) || FALLBACK_HEYGEN_AVATAR;
    let avatarVideoUrl: string | null = null;
    let avatarJobId: string | null = null;

    if (Deno.env.get('HEYGEN_API_KEY')) {
      const submitted = await submitHeyGenJob(audioUrl, avatarId);
      avatarJobId = submitted.video_id;
      avatarVideoUrl = await pollHeyGen(submitted.video_id);
      await sb.from('tiktok_video_renders').update({
        avatar_provider_job_id: avatarJobId,
        avatar_video_url: avatarVideoUrl,
      }).eq('id', renderId);
    } else {
      // No HeyGen key — skip avatar, worker will use audio-only with text overlay
      console.warn('[render-orchestrator] HEYGEN_API_KEY not set — skipping avatar');
    }

    // ── 5. Pexels b-roll for beats that need it ──────────────────────────
    await markStep(sb, renderId, 'broll');
    const brollUrls: Array<{ beat_index: number; url: string | null }> = [];
    if (Deno.env.get('PEXELS_API_KEY')) {
      for (const beat of (script.beats || [])) {
        if (beat.visual === 'broll' && beat.broll_query) {
          const url = await searchPexels(beat.broll_query);
          brollUrls.push({ beat_index: beat.index, url });
        }
      }
    }
    await sb.from('tiktok_video_renders').update({ broll_urls: brollUrls }).eq('id', renderId);

    // ── 6. Dispatch to worker ────────────────────────────────────────────
    await markStep(sb, renderId, 'compositing');
    const workerUrl = Deno.env.get('REMOTION_WORKER_URL');
    if (!workerUrl) {
      // No worker configured — leave render at 'compositing' state, admin sees
      // the partial outputs and can manually composite. The dashboard will
      // show a "Worker not configured" hint.
      await sb.from('tiktok_video_renders').update({
        step: 'awaiting_worker',
        error_message: 'REMOTION_WORKER_URL not configured. Audio + avatar are ready; configure worker to finish compositing.',
      }).eq('id', renderId);
      await logRun(sb, 'render', 'partial', startedAt, scriptId, 'Audio + avatar ready, worker not configured');
      // Telegram ping (best-effort) so admin knows assets are ready for QA
      try {
        await fetch(`${SUPABASE_URL}/functions/v1/bot-send-telegram`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SERVICE_ROLE}` },
          body: JSON.stringify({
            message: `🎬 *TikTok assets ready for QA*\n\nRender \`${renderId.slice(0, 8)}\` — audio + avatar + b-roll generated.\nWorker not deployed yet → no MP4.\n\nReview in /admin/tiktok → Renders tab.`,
            parse_mode: 'Markdown',
            admin_only: true,
            format_version: 'v3',
            reference_key: `tiktok_assets_ready_${renderId}`,
          }),
        });
      } catch (_) { /* never fail orchestrator on alert error */ }
      return jsonResp({ success: true, render_id: renderId, step: 'awaiting_worker', audio_url: audioUrl, avatar_video_url: avatarVideoUrl });
    }

    const callbackUrl = `${SUPABASE_URL}/functions/v1/tiktok-render-callback`;
    const workerResp = await fetch(workerUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${Deno.env.get('REMOTION_WORKER_SECRET') || ''}`,
      },
      body: JSON.stringify({
        render_id: renderId,
        script_id: scriptId,
        composition: compositionForTemplate(script.template),
        callback_url: callbackUrl,
        callback_secret: Deno.env.get('REMOTION_WORKER_SECRET') || '',
        props: {
          script,
          audioUrl,
          audioTimings: timings,
          audioDurationSec: durationSec,
          avatarVideoUrl,
          brollUrls,
        },
      }),
    });
    if (!workerResp.ok) throw new Error(`Worker error ${workerResp.status}: ${await workerResp.text()}`);
    const { job_id } = await workerResp.json();
    await sb.from('tiktok_video_renders').update({ worker_job_id: job_id }).eq('id', renderId);

    await logRun(sb, 'render', 'success', startedAt, scriptId, `Dispatched to worker; job=${job_id}`);
    return jsonResp({ success: true, render_id: renderId, worker_job_id: job_id, step: 'compositing' });

  } catch (err: any) {
    console.error('[render-orchestrator] error:', err);
    if (renderId) {
      await sb.from('tiktok_video_renders').update({
        status: 'failed', step: 'error', error_message: String(err?.message || err),
      }).eq('id', renderId);
    }
    if (scriptId) {
      await sb.from('tiktok_video_scripts').update({ status: 'approved' }).eq('id', scriptId);
    }
    await logRun(sb, 'render', 'failed', startedAt, scriptId, String(err?.message || err));
    return jsonResp({ success: false, error: String(err?.message || err) }, 500);
  }
});

// ── Helpers ─────────────────────────────────────────────────────────────────

function jsonResp(body: any, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

function compositionForTemplate(t: string): string {
  if (t === 'pick_reveal') return 'PickReveal';
  if (t === 'results_recap') return 'ResultsRecap';
  return 'DataInsight';
}

function buildVoiceoverText(script: any): string {
  const parts: string[] = [];
  if (script.hook?.vo_text) parts.push(script.hook.vo_text);
  for (const b of (script.beats || [])) if (b.vo_text) parts.push(b.vo_text);
  if (script.cta?.vo_text) parts.push(script.cta.vo_text);
  return parts.join(' ');
}

async function markStep(sb: any, renderId: string, step: string) {
  await sb.from('tiktok_video_renders').update({
    step, step_started_at: new Date().toISOString(),
  }).eq('id', renderId);
}

async function logRun(sb: any, runType: string, status: string, startedAt: number, scriptId: string | null, message: string) {
  await sb.from('tiktok_pipeline_logs').insert({
    run_type: runType,
    status,
    duration_ms: Date.now() - startedAt,
    message: message.slice(0, 500),
    metadata: scriptId ? { script_id: scriptId } : {},
  });
}

async function uploadAndSign(sb: any, path: string, bytes: Uint8Array, contentType: string): Promise<string> {
  const { error: upErr } = await sb.storage.from(STORAGE_BUCKET).upload(path, bytes, { contentType, upsert: true });
  if (upErr) throw upErr;
  const { data, error } = await sb.storage.from(STORAGE_BUCKET).createSignedUrl(path, 60 * 60 * 12); // 12h
  if (error) throw error;
  return data.signedUrl;
}

// ── ElevenLabs ──────────────────────────────────────────────────────────────
async function synthesizeVoice(text: string, voiceId: string): Promise<{ audio: Uint8Array; timings: any[]; durationSec: number }> {
  const apiKey = Deno.env.get('ELEVENLABS_API_KEY');
  if (!apiKey) throw new Error('ELEVENLABS_API_KEY not configured');

  const resp = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/with-timestamps?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'xi-api-key': apiKey, 'accept': 'application/json' },
    body: JSON.stringify({
      text,
      model_id: 'eleven_multilingual_v2',
      voice_settings: { stability: 0.55, similarity_boost: 0.75, style: 0.4, use_speaker_boost: true },
    }),
  });
  if (!resp.ok) throw new Error(`ElevenLabs ${resp.status}: ${await resp.text()}`);
  const data = await resp.json();

  // Decode base64 audio safely (no spread, avoids stack overflow)
  const binary = atob(data.audio_base64);
  const audio = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) audio[i] = binary.charCodeAt(i);

  const timings = charsToWords(
    data.alignment.characters,
    data.alignment.character_start_times_seconds,
    data.alignment.character_end_times_seconds,
  );
  const durationSec = timings.length ? timings[timings.length - 1].end_sec : 0;
  return { audio, timings, durationSec };
}

function charsToWords(chars: string[], starts: number[], ends: number[]): Array<{ word: string; start_sec: number; end_sec: number }> {
  const out: Array<{ word: string; start_sec: number; end_sec: number }> = [];
  let buf = '', wStart: number | null = null;
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    if (/\s/.test(c) || /[.,!?;:]/.test(c)) {
      if (buf) { out.push({ word: buf, start_sec: wStart ?? starts[i], end_sec: ends[i - 1] ?? ends[i] }); buf = ''; wStart = null; }
    } else {
      if (wStart === null) wStart = starts[i];
      buf += c;
    }
  }
  if (buf && wStart !== null) out.push({ word: buf, start_sec: wStart, end_sec: ends[ends.length - 1] ?? wStart + 0.5 });
  return out;
}

// ── HeyGen ──────────────────────────────────────────────────────────────────
async function submitHeyGenJob(audioUrl: string, avatarId: string): Promise<{ video_id: string }> {
  const apiKey = Deno.env.get('HEYGEN_API_KEY')!;
  const resp = await fetch('https://api.heygen.com/v2/video/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Api-Key': apiKey },
    body: JSON.stringify({
      video_inputs: [{
        character: { type: 'avatar', avatar_id: avatarId, avatar_style: 'normal' },
        voice: { type: 'audio', audio_url: audioUrl },
        background: { type: 'color', value: '#000000' },
      }],
      dimension: { width: 1080, height: 1920 },
      caption: false,
    }),
  });
  if (!resp.ok) throw new Error(`HeyGen submit ${resp.status}: ${await resp.text()}`);
  const d = await resp.json();
  const id = d?.data?.video_id || d?.video_id;
  if (!id) throw new Error('HeyGen returned no video_id');
  return { video_id: id };
}

async function pollHeyGen(videoId: string, timeoutSec = 600): Promise<string> {
  const apiKey = Deno.env.get('HEYGEN_API_KEY')!;
  const start = Date.now();
  while (Date.now() - start < timeoutSec * 1000) {
    const r = await fetch(`https://api.heygen.com/v1/video_status.get?video_id=${videoId}`, { headers: { 'X-Api-Key': apiKey } });
    if (!r.ok) throw new Error(`HeyGen poll ${r.status}`);
    const d = (await r.json()).data ?? {};
    if (d.status === 'completed' && d.video_url) return d.video_url;
    if (d.status === 'failed') throw new Error(`HeyGen failed: ${d.error?.message || 'unknown'}`);
    await new Promise(r => setTimeout(r, 15000));
  }
  throw new Error(`HeyGen timed out after ${timeoutSec}s`);
}

// ── Pexels ──────────────────────────────────────────────────────────────────
async function searchPexels(query: string): Promise<string | null> {
  const apiKey = Deno.env.get('PEXELS_API_KEY');
  if (!apiKey) return null;
  const u = new URL('https://api.pexels.com/videos/search');
  u.searchParams.set('query', query);
  u.searchParams.set('per_page', '5');
  u.searchParams.set('orientation', 'portrait');
  const r = await fetch(u.toString(), { headers: { Authorization: apiKey } });
  if (!r.ok) return null;
  const d = await r.json();
  for (const v of (d.videos || [])) {
    const files = (v.video_files || []).filter((f: any) => f.link?.endsWith('.mp4'));
    const preferred = files.find((f: any) => f.width === 1080 && f.height === 1920) || files[0];
    if (preferred?.link) return preferred.link;
  }
  return null;
}