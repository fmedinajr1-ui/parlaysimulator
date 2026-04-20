// ──────────────────────────────────────────────────────────────────────────────
// TikTok Caption Generator (Phase 3)
// ──────────────────────────────────────────────────────────────────────────────
// Given a script_id, generates the *final* caption + hashtag list using
// Lovable AI Gateway, persona-aware via tiktok_accounts.caption_template +
// baseline_hashtags. Stores result on tiktok_video_scripts:
//   - final_caption  (text, ≤ 150 chars, no @ mentions, no banned words)
//   - final_hashtags (text[], 4–8 tags, dedup with persona baseline)
//   - caption_generated_at
//
// Auto-invoked from tiktok-render-callback when a render completes, and can be
// re-run manually from the admin Publish tab.
// ──────────────────────────────────────────────────────────────────────────────

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');

// Banned in TikTok captions per platform policy (rough heuristic — safety-gate
// already handles VO; this is the second filter for caption text).
const CAPTION_BLOCKLIST = [
  'guaranteed', 'lock', 'sure thing', 'risk free', 'risk-free',
  'fixed', 'inside info', 'no risk', 'free money',
];

function cleanCaption(raw: string): string {
  let c = raw.trim().replace(/^"|"$/g, '');
  // Strip @mentions
  c = c.replace(/@\w+/g, '').replace(/\s{2,}/g, ' ').trim();
  // Truncate to 150
  if (c.length > 150) c = c.slice(0, 147).trimEnd() + '…';
  return c;
}

function dedupHashtags(generated: string[], baseline: string[]): string[] {
  const norm = (t: string) => t.toLowerCase().replace(/^#/, '').trim();
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of [...baseline, ...generated]) {
    const n = norm(t);
    if (!n || seen.has(n)) continue;
    seen.add(n);
    out.push('#' + n);
    if (out.length >= 8) break;
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const { script_id } = await req.json();
    if (!script_id) {
      return new Response(JSON.stringify({ error: 'script_id required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: 'LOVABLE_API_KEY not configured' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const sb = createClient(SUPABASE_URL, SERVICE_ROLE);

    // Load script + account
    const { data: script, error: sErr } = await sb.from('tiktok_video_scripts')
      .select('*').eq('id', script_id).maybeSingle();
    if (sErr || !script) throw new Error(`script not found: ${sErr?.message || script_id}`);

    let account: any = null;
    if (script.account_id) {
      const { data: a } = await sb.from('tiktok_accounts').select('*').eq('id', script.account_id).maybeSingle();
      account = a;
    }
    if (!account) {
      const { data: a } = await sb.from('tiktok_accounts').select('*').eq('persona_key', script.target_persona_key).maybeSingle();
      account = a;
    }

    const captionTemplate = account?.caption_template || 'Quick read on {topic}. {hook}';
    const baselineHashtags = account?.baseline_hashtags || [];
    const tone = account?.tone_description || 'concise sports analyst';

    const beatsSummary = (script.beats || []).slice(0, 4).map((b: any) => b.vo_text).join(' ');

    const systemPrompt = `You write TikTok captions for sports betting analysis content. Tone: ${tone}.
Rules:
- Max 150 characters total
- No @mentions, no URLs
- No guarantees ("lock", "guaranteed", "sure thing", "fixed", "free money")
- Conversational, hook-first, ends with one engagement prompt (question or "thoughts?")
- Avoid emojis at the start (allow 1–2 mid-caption max)
Persona caption template hint (loose guide, do not copy verbatim):
${captionTemplate}`;

    const userPrompt = `Generate a final TikTok caption + 4-6 fresh hashtags for this script:

HOOK: ${script.hook?.vo_text || ''}
TEMPLATE: ${script.template}
TOPIC SEED: ${script.caption_seed || beatsSummary}
BEATS: ${beatsSummary}
CTA: ${script.cta?.vo_text || ''}

Baseline hashtags already attached (do NOT repeat these): ${baselineHashtags.join(' ')}

Return via the publish_caption tool.`;

    const aiResp = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-3-flash-preview',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        tools: [{
          type: 'function',
          function: {
            name: 'publish_caption',
            description: 'Return the final TikTok caption and fresh hashtags.',
            parameters: {
              type: 'object',
              properties: {
                caption: { type: 'string', description: 'Final caption, ≤150 chars.' },
                hashtags: {
                  type: 'array',
                  items: { type: 'string' },
                  description: '4-6 fresh hashtags WITHOUT the # prefix.',
                },
              },
              required: ['caption', 'hashtags'],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: 'function', function: { name: 'publish_caption' } },
      }),
    });

    if (!aiResp.ok) {
      if (aiResp.status === 429) {
        return new Response(JSON.stringify({ error: 'AI rate-limited, retry shortly' }), {
          status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      if (aiResp.status === 402) {
        return new Response(JSON.stringify({ error: 'AI credits exhausted — top up Lovable AI workspace' }), {
          status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const t = await aiResp.text();
      throw new Error(`AI gateway error ${aiResp.status}: ${t.slice(0, 200)}`);
    }

    const aiJson = await aiResp.json();
    const toolCall = aiJson?.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall?.function?.arguments) throw new Error('AI returned no tool call');
    const args = JSON.parse(toolCall.function.arguments);

    const caption = cleanCaption(String(args.caption || ''));
    const lc = caption.toLowerCase();
    if (CAPTION_BLOCKLIST.some(w => lc.includes(w))) {
      throw new Error(`caption contains banned phrase: ${caption}`);
    }

    const hashtags = dedupHashtags(
      (args.hashtags || []).map((t: string) => String(t)),
      baselineHashtags,
    );

    await sb.from('tiktok_video_scripts').update({
      final_caption: caption,
      final_hashtags: hashtags,
      caption_generated_at: new Date().toISOString(),
    }).eq('id', script_id);

    return new Response(JSON.stringify({ ok: true, caption, hashtags }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err: any) {
    console.error('[tiktok-caption-generator] error:', err);
    return new Response(JSON.stringify({ error: String(err?.message || err) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});