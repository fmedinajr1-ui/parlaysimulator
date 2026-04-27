// Lightweight AI roast generator. Wraps Lovable AI Gateway and falls back to
// static lines so the slip analyzer never breaks on rate limits or outages.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const FALLBACK_ROASTS = [
  "This parlay was built with vibes, not math.",
  "The book is sending you a thank-you card already.",
  "We've seen sharper picks at a coin-flip convention.",
  "Three of these legs are in a witness protection program from logic.",
  "Bold strategy. Bad math. Brave wallet.",
];

interface InputLeg {
  description?: string;
  odds?: number | string;
  impliedProbability?: number;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const legs: InputLeg[] = Array.isArray(body?.legs) ? body.legs : [];
    const probability: number = Number(body?.probability ?? 0);
    const stake: number = Number(body?.stake ?? 0);
    const potentialPayout: number = Number(body?.potentialPayout ?? 0);
    const recommendedAction: string | undefined = body?.recommendedAction;
    const summary: string | undefined = body?.summary;

    const apiKey = Deno.env.get('LOVABLE_API_KEY');
    if (!apiKey || legs.length === 0) {
      return new Response(JSON.stringify({ roasts: FALLBACK_ROASTS.slice(0, 3) }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const legText = legs.slice(0, 8).map((l, i) => {
      const odds = typeof l.odds === 'number' ? l.odds : parseInt(String(l.odds ?? '-110'), 10);
      return `${i + 1}. ${l.description ?? 'leg'} @ ${odds > 0 ? '+' : ''}${odds}`;
    }).join('\n');

    const prompt = `You are a brutal but funny sports betting analyst. Roast this parlay in EXACTLY 3 short, punchy lines. Each line under 90 chars. No emojis at the start. Sharp wit, not mean. Reference specific legs by player name when possible.

Win probability: ${(probability * 100).toFixed(1)}%
Stake: $${stake.toFixed(2)}, payout: $${potentialPayout.toFixed(2)}
Verdict: ${recommendedAction ?? 'unknown'}
Summary: ${summary ?? 'n/a'}

Legs:
${legText}

Return ONLY a JSON object: { "roasts": ["line1", "line2", "line3"] }`;

    const aiRes = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: 'You return only valid JSON. No markdown.' },
          { role: 'user', content: prompt },
        ],
        response_format: { type: 'json_object' },
      }),
    });

    if (!aiRes.ok) {
      console.error('AI gateway error', aiRes.status, await aiRes.text());
      return new Response(JSON.stringify({ roasts: FALLBACK_ROASTS.slice(0, 3) }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const data = await aiRes.json();
    const content = data?.choices?.[0]?.message?.content ?? '{}';
    let roasts: string[] = [];
    try {
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed.roasts)) roasts = parsed.roasts.filter((s: any) => typeof s === 'string').slice(0, 3);
    } catch {
      // ignore parse errors
    }
    if (roasts.length === 0) roasts = FALLBACK_ROASTS.slice(0, 3);

    return new Response(JSON.stringify({ roasts }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('generate-roasts error', err);
    return new Response(JSON.stringify({ roasts: FALLBACK_ROASTS.slice(0, 3) }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});