import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { imageBase64 } = await req.json();
    
    if (!imageBase64) {
      return new Response(
        JSON.stringify({ error: "No image provided" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      console.error("LOVABLE_API_KEY is not configured");
      return new Response(
        JSON.stringify({ error: "AI service not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("Processing betting slip image with AI...");

    const systemPrompt = `You are an expert at reading betting slips and sports betting parlays. 
Your job is to extract parlay information from betting slip images.

Extract the following information:
1. All individual legs with their descriptions and American odds
2. The TOTAL PARLAY ODDS if shown on the slip (look for total odds, combined odds, or parlay odds - usually a single number like "+2456" or "-150")
3. The STAKE/WAGER amount if visible (the amount being bet, e.g., "$10.00", "$25")
4. The POTENTIAL PAYOUT or "To Win" amount if visible

For individual legs, extract:
- The description (team name, player name, bet type like "ML", "Over/Under", spread, etc.)
- The American odds for THAT SPECIFIC LEG (like +150, -110, +250, etc.)

IMPORTANT: 
- The TOTAL ODDS is different from individual leg odds - it's the combined odds for the entire parlay
- Look for labels like "Total Odds", "Parlay Odds", "Combined", or just a prominently displayed odds value
- For stake, look for "Wager", "Stake", "Bet Amount", or dollar amounts
- For payout, look for "To Win", "Potential Payout", "Returns", etc.

Return ONLY valid JSON in this exact format:
{
  "legs": [
    {"description": "Lakers ML", "odds": "-150"},
    {"description": "Chiefs -3.5", "odds": "-110"},
    {"description": "Curry Over 25.5 Pts", "odds": "+120"}
  ],
  "totalOdds": "+2456",
  "stake": "25.00",
  "potentialPayout": "638.50"
}

Rules:
- Set totalOdds, stake, or potentialPayout to null if not clearly visible on the slip
- For odds, always include the + or - sign
- For stake and potentialPayout, just use the number without $ symbol
- Keep leg descriptions concise
- If you cannot read the image clearly or it's not a betting slip, return: {"legs": [], "totalOdds": null, "stake": null, "potentialPayout": null}`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Extract all parlay information from this betting slip image. Return only the JSON."
              },
              {
                type: "image_url",
                image_url: {
                  url: imageBase64.startsWith("data:") ? imageBase64 : `data:image/jpeg;base64,${imageBase64}`
                }
              }
            ]
          }
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("AI gateway error:", response.status, errorText);
      
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "AI credits depleted. Please add credits to continue." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      return new Response(
        JSON.stringify({ error: "Failed to process image" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "{}";
    
    console.log("AI response:", content);

    // Parse the JSON from the response
    let result = { legs: [], totalOdds: null, stake: null, potentialPayout: null };
    try {
      // Try to extract JSON from the response (it might have markdown code blocks)
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        result = {
          legs: parsed.legs || [],
          totalOdds: parsed.totalOdds || null,
          stake: parsed.stake || null,
          potentialPayout: parsed.potentialPayout || null
        };
      }
    } catch (parseError) {
      console.error("Failed to parse AI response:", parseError);
      // Try legacy array format as fallback
      try {
        const arrayMatch = content.match(/\[[\s\S]*\]/);
        if (arrayMatch) {
          result.legs = JSON.parse(arrayMatch[0]);
        }
      } catch {
        console.error("Failed to parse legacy format too");
      }
    }

    console.log("Extracted data:", result);

    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in extract-parlay function:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
