import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ParlayLeg {
  description: string;
  odds: number;
  impliedProbability: number;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { legs, probability, degenerateLevel, stake, potentialPayout } = await req.json();

    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    if (!OPENAI_API_KEY) {
      console.error("OPENAI_API_KEY is not configured");
      return new Response(
        JSON.stringify({ error: "AI service not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const probabilityPct = (probability * 100).toFixed(2);
    const legsDescription = legs.map((leg: ParlayLeg, idx: number) => 
      `Leg ${idx + 1}: "${leg.description}" at ${leg.odds > 0 ? '+' : ''}${leg.odds} (${(leg.impliedProbability * 100).toFixed(1)}% implied prob)`
    ).join("\n");

    const systemPrompt = `You are a savage, hilarious sports betting AI called "BookieKillerAI" that roasts people's parlays. 
You're brutally honest but entertaining - like a stand-up comedian who also knows sports betting.

Your style:
- Use modern slang and memes (cooked, bussin, no cap, caught in 4K, etc.)
- Reference specific legs by name when roasting them
- Be specific about WHY certain legs are bad
- Use emojis strategically for emphasis 🔥💀😭
- Sound like a funny Twitter/X personality
- Mix in gambling lingo (chalk, juice, sharp, square, etc.)
- Reference pop culture when relevant
- Keep each roast punchy (1-2 sentences max)

IMPORTANT: Generate 4-6 roasts as a JSON array of strings. Each roast should be unique and reference different aspects of the parlay.`;

    const userPrompt = `Roast this parlay:

PARLAY DETAILS:
${legsDescription}

Combined Win Probability: ${probabilityPct}%
Degen Level: ${degenerateLevel}
Stake: $${stake}
Potential Payout: $${potentialPayout.toFixed(2)}

Generate 4-6 savage roasts about this parlay. Reference specific legs when appropriate. Return ONLY a JSON array of strings.`;

    console.log("Generating roasts for parlay with OpenAI...");

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        max_tokens: 1000,
        temperature: 0.9,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("OpenAI API error:", response.status, errorText);
      
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded" }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (response.status === 402 || response.status === 401) {
        return new Response(
          JSON.stringify({ error: "AI service error" }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      return new Response(
        JSON.stringify({ error: "Failed to generate roasts" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "[]";
    
    console.log("OpenAI response:", content);

    // Parse the JSON array from the response
    let roasts: string[] = [];
    try {
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        roasts = JSON.parse(jsonMatch[0]);
      }
    } catch (parseError) {
      console.error("Failed to parse AI response:", parseError);
      // Fallback roasts
      roasts = [
        "This parlay has more red flags than a Miami club. 🚩",
        "The books are sending you a thank you card. 💸",
        "This is giving 'I will pay rent next month' energy. 🏠",
      ];
    }

    // Ensure we have at least some roasts
    if (roasts.length === 0) {
      roasts = [
        "This parlay is absolutely cooked. 💀",
        "Vegas thanks you for your donation. 🎰",
      ];
    }

    console.log("Generated roasts:", roasts);

    return new Response(
      JSON.stringify({ roasts }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in generate-roasts function:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
