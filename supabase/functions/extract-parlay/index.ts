import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ExtractedLeg {
  description: string;
  odds: string;
  gameTime?: string | null;
}

interface ExtractionResult {
  legs: ExtractedLeg[];
  totalOdds: string | null;
  stake: string | null;
  potentialPayout: string | null;
  earliestGameTime: string | null;
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { imageBase64, frames } = body;
    
    // Support both single image and multiple frames
    const imagesToProcess: string[] = frames && Array.isArray(frames) && frames.length > 0 
      ? frames 
      : imageBase64 
        ? [imageBase64] 
        : [];
    
    if (imagesToProcess.length === 0) {
      return new Response(
        JSON.stringify({ error: "No image or frames provided" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Processing ${imagesToProcess.length} image(s)...`);

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      console.error("LOVABLE_API_KEY is not configured");
      return new Response(
        JSON.stringify({ error: "AI service not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const systemPrompt = `You are an expert at reading betting slips and sports betting parlays. 
Your job is to extract parlay information from betting slip images.

Extract the following information:
1. All individual legs with their descriptions, American odds, and game date/time
2. The TOTAL PARLAY ODDS if shown on the slip (look for total odds, combined odds, or parlay odds - usually a single number like "+2456" or "-150")
3. The STAKE/WAGER amount if visible (the amount being bet, e.g., "$10.00", "$25")
4. The POTENTIAL PAYOUT or "To Win" amount if visible
5. The EARLIEST game date/time from all legs (for when the parlay starts)

For individual legs, extract:
- The description (team name, player name, bet type like "ML", "Over/Under", spread, etc.)
- The American odds for THAT SPECIFIC LEG (like +150, -110, +250, etc.)
- The game date/time if visible (look for dates like "Nov 28", "11/28", times like "7:00 PM", "19:00", or combined like "Nov 28 7:00 PM EST")

IMPORTANT: 
- The TOTAL ODDS is different from individual leg odds - it's the combined odds for the entire parlay
- Look for labels like "Total Odds", "Parlay Odds", "Combined", or just a prominently displayed odds value
- For stake, look for "Wager", "Stake", "Bet Amount", or dollar amounts
- For payout, look for "To Win", "Potential Payout", "Returns", etc.
- For game times, betting apps typically show the date/time near each leg or game matchup
- Common formats: "Today 7:00 PM", "Tomorrow 1:00 PM", "Nov 28, 2024 7:00 PM", "11/28 19:00"
- If this doesn't look like a betting slip at all, return empty results

Return ONLY valid JSON in this exact format:
{
  "legs": [
    {"description": "Lakers ML", "odds": "-150", "gameTime": "Nov 28, 2024 7:00 PM EST"},
    {"description": "Chiefs -3.5", "odds": "-110", "gameTime": "Nov 28, 2024 8:30 PM EST"},
    {"description": "Curry Over 25.5 Pts", "odds": "+120", "gameTime": "Nov 29, 2024 10:00 PM EST"}
  ],
  "totalOdds": "+2456",
  "stake": "25.00",
  "potentialPayout": "638.50",
  "earliestGameTime": "Nov 28, 2024 7:00 PM EST",
  "isBettingSlip": true
}

Rules:
- Set isBettingSlip to false if the image doesn't appear to be a betting slip
- Set totalOdds, stake, potentialPayout, or earliestGameTime to null if not clearly visible
- Set individual leg gameTime to null if not visible for that leg
- For odds, always include the + or - sign
- For stake and potentialPayout, just use the number without $ symbol
- For game times, include timezone if visible, otherwise assume local time
- earliestGameTime should be the soonest game time from all legs
- Keep leg descriptions concise
- If you cannot read the image clearly or it's not a betting slip, return: {"legs": [], "totalOdds": null, "stake": null, "potentialPayout": null, "earliestGameTime": null, "isBettingSlip": false}`;

    // Process all images and collect results
    const allResults: ExtractionResult[] = [];
    let framesWithSlips = 0;
    
    // For video frames, process in batches to avoid rate limits
    const batchSize = imagesToProcess.length > 1 ? 3 : 1;
    
    for (let i = 0; i < imagesToProcess.length; i += batchSize) {
      const batch = imagesToProcess.slice(i, i + batchSize);
      
      const batchPromises = batch.map(async (imageData, batchIndex) => {
        const imageIndex = i + batchIndex;
        console.log(`Processing image ${imageIndex + 1}/${imagesToProcess.length}...`);
        
        try {
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
                      text: imagesToProcess.length > 1 
                        ? `This is frame ${imageIndex + 1} from a screen recording. Extract any betting slip information visible. Return only JSON.`
                        : "Extract all parlay information from this betting slip image. Return only the JSON."
                    },
                    {
                      type: "image_url",
                      image_url: {
                        url: imageData.startsWith("data:") ? imageData : `data:image/jpeg;base64,${imageData}`
                      }
                    }
                  ]
                }
              ],
            }),
          });

          if (!response.ok) {
            const errorText = await response.text();
            console.error(`Image ${imageIndex + 1} error:`, response.status, errorText);
            
            if (response.status === 429) {
              // Rate limited - wait and the caller should retry
              throw new Error("Rate limit exceeded");
            }
            if (response.status === 402) {
              throw new Error("AI usage limit reached");
            }
            return null;
          }

          const data = await response.json();
          const content = data.choices?.[0]?.message?.content || "{}";
          
          // Parse the JSON from the response
          try {
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              const parsed = JSON.parse(jsonMatch[0]);
              
              // Only count frames that actually have betting slip content
              if (parsed.isBettingSlip !== false && parsed.legs && parsed.legs.length > 0) {
                framesWithSlips++;
                return {
                  legs: parsed.legs || [],
                  totalOdds: parsed.totalOdds || null,
                  stake: parsed.stake || null,
                  potentialPayout: parsed.potentialPayout || null,
                  earliestGameTime: parsed.earliestGameTime || null
                } as ExtractionResult;
              }
            }
          } catch (parseError) {
            console.error(`Failed to parse response for image ${imageIndex + 1}:`, parseError);
          }
          
          return null;
        } catch (err) {
          console.error(`Error processing image ${imageIndex + 1}:`, err);
          if (err instanceof Error && (err.message.includes("Rate limit") || err.message.includes("usage limit"))) {
            throw err; // Re-throw rate limit errors
          }
          return null;
        }
      });
      
      try {
        const batchResults = await Promise.all(batchPromises);
        batchResults.forEach(r => { if (r) allResults.push(r); });
      } catch (err) {
        if (err instanceof Error && err.message.includes("Rate limit")) {
          return new Response(
            JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }),
            { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        if (err instanceof Error && err.message.includes("usage limit")) {
          return new Response(
            JSON.stringify({ error: "AI usage limit reached. Please add credits to your workspace." }),
            { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }
      
      // Small delay between batches for video frames
      if (imagesToProcess.length > 1 && i + batchSize < imagesToProcess.length) {
        await new Promise(r => setTimeout(r, 500));
      }
    }

    console.log(`Found betting slip content in ${framesWithSlips}/${imagesToProcess.length} frames`);

    // Merge all results, deduplicating legs
    const mergedResult: ExtractionResult = {
      legs: [],
      totalOdds: null,
      stake: null,
      potentialPayout: null,
      earliestGameTime: null
    };

    const seenLegs = new Set<string>();

    for (const result of allResults) {
      // Add unique legs
      for (const leg of result.legs) {
        // Create a normalized key for deduplication
        const legKey = `${leg.description.toLowerCase().replace(/\s+/g, ' ').trim()}|${leg.odds}`;
        if (!seenLegs.has(legKey)) {
          seenLegs.add(legKey);
          mergedResult.legs.push(leg);
        }
      }
      
      // Take first non-null values for other fields
      if (!mergedResult.totalOdds && result.totalOdds) mergedResult.totalOdds = result.totalOdds;
      if (!mergedResult.stake && result.stake) mergedResult.stake = result.stake;
      if (!mergedResult.potentialPayout && result.potentialPayout) mergedResult.potentialPayout = result.potentialPayout;
      if (!mergedResult.earliestGameTime && result.earliestGameTime) mergedResult.earliestGameTime = result.earliestGameTime;
    }

    console.log(`Merged result: ${mergedResult.legs.length} unique legs from ${allResults.length} frames with betting content`);

    return new Response(
      JSON.stringify({
        ...mergedResult,
        framesProcessed: imagesToProcess.length,
        framesWithSlips
      }),
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