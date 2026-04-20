// Phase 4 — Generate AI variants of a top-performing hook.
// Uses Lovable AI Gateway (no API key required).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY')!;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { hook_id } = await req.json();
    if (!hook_id || typeof hook_id !== 'string') {
      return new Response(JSON.stringify({ error: 'hook_id required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const sb = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { data: source, error: sErr } = await sb
      .from('tiktok_hook_performance')
      .select('*')
      .eq('id', hook_id)
      .single();
    if (sErr || !source) throw sErr || new Error('Hook not found');

    const prompt = `You are writing TikTok hook variants for a sports-betting persona.

SOURCE HOOK (top performer): "${source.text}"
Style: ${source.style}
Template: ${source.template}

Write 3 fresh variants that:
- Keep the same energy and style as the source
- Use a different opening word than the source
- Are 8-14 words each
- Avoid hype words like "guaranteed", "lock", "free money"
- Sound natural when spoken aloud
- Hint at insight or curiosity, not certainty

Return JSON only.`;

    const aiRes = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [{ role: 'user', content: prompt }],
        tools: [{
          type: 'function',
          function: {
            name: 'submit_variants',
            parameters: {
              type: 'object',
              required: ['variants'],
              properties: {
                variants: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'string' } },
              },
            },
          },
        }],
        tool_choice: { type: 'function', function: { name: 'submit_variants' } },
      }),
    });

    if (aiRes.status === 429) throw new Error('AI rate limit — try again in a minute');
    if (aiRes.status === 402) throw new Error('AI credits exhausted — top up Lovable Cloud');
    if (!aiRes.ok) throw new Error(`AI error: ${aiRes.status} ${await aiRes.text()}`);

    const aiData = await aiRes.json();
    const toolCall = aiData?.choices?.[0]?.message?.tool_calls?.[0];
    const args = toolCall?.function?.arguments ? JSON.parse(toolCall.function.arguments) : null;
    const variants: string[] = (args?.variants || []).filter((v: unknown) => typeof v === 'string' && v.length > 4);
    if (variants.length === 0) throw new Error('AI returned no usable variants');

    const inserts = variants.map((text) => ({
      text,
      style: source.style,
      template: source.template,
      origin: 'learned' as const,
      active: true,
      notes: `Generated from hook ${source.id} (avg_compl ${Number(source.avg_completion_rate).toFixed(2)})`,
    }));

    const { data: inserted, error: insErr } = await sb
      .from('tiktok_hook_performance')
      .insert(inserts)
      .select();
    if (insErr) throw insErr;

    return new Response(JSON.stringify({ ok: true, count: inserted?.length || 0, variants: inserted }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ ok: false, error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});