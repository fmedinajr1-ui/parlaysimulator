import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ============= INTERFACES =============

interface ExtractedLeg {
  description: string;
  odds: string;
  gameTime?: string | null;
  gameTimeISO?: string | null;
}

interface ExtractionResult {
  legs: ExtractedLeg[];
  totalOdds: string | null;
  stake: number | null;
  potentialPayout: number | null;
  earliestGameTime: string | null;
  earliestGameTimeISO: string | null;
  isBettingSlip: boolean;
  originalOddsFormat: 'american' | 'decimal' | 'fractional' | null;
}

// ============= HELPER FUNCTIONS =============

/**
 * Parse numeric value from string, handling currency symbols and formatting
 */
function parseNumericValue(value: string | null | undefined): number | null {
  if (!value) return null;
  const cleaned = value.toString().replace(/[$€£,\s]/g, '');
  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? null : parsed;
}

/**
 * Detect odds format from string
 */
function detectOddsFormat(odds: string): 'american' | 'decimal' | 'fractional' {
  if (!odds) return 'american';
  const trimmed = odds.trim();
  
  // Fractional: contains "/" (e.g., "3/2", "5/1")
  if (trimmed.includes('/')) return 'fractional';
  
  // American: starts with + or - followed by digits (e.g., "+150", "-110")
  if (/^[+-]\d+$/.test(trimmed)) return 'american';
  
  // Decimal: just a number with decimal point (e.g., "2.50", "1.91")
  if (/^\d+\.?\d*$/.test(trimmed)) return 'decimal';
  
  // Default to american
  return 'american';
}

/**
 * Convert odds from any format to American odds
 */
function convertToAmericanOdds(odds: string, format: 'american' | 'decimal' | 'fractional'): string {
  const trimmed = odds.trim();
  
  try {
    switch (format) {
      case 'decimal': {
        const decimal = parseFloat(trimmed);
        if (isNaN(decimal) || decimal <= 1) return trimmed;
        if (decimal >= 2) {
          return `+${Math.round((decimal - 1) * 100)}`;
        }
        return `${Math.round(-100 / (decimal - 1))}`;
      }
      
      case 'fractional': {
        const parts = trimmed.split('/');
        if (parts.length !== 2) return trimmed;
        const [num, den] = parts.map(Number);
        if (isNaN(num) || isNaN(den) || den === 0) return trimmed;
        const decimalFromFrac = (num / den) + 1;
        if (decimalFromFrac >= 2) {
          return `+${Math.round((decimalFromFrac - 1) * 100)}`;
        }
        return `${Math.round(-100 / (decimalFromFrac - 1))}`;
      }
      
      case 'american':
      default:
        // Ensure proper formatting with + or -
        if (/^\d+$/.test(trimmed)) {
          return `+${trimmed}`;
        }
        return trimmed;
    }
  } catch (e) {
    console.warn(`Failed to convert odds "${odds}" from ${format}:`, e);
    return trimmed;
  }
}

/**
 * Extract balanced JSON from content by counting braces
 */
function extractBalancedBraces(content: string): string | null {
  const start = content.indexOf('{');
  if (start === -1) return null;
  
  let depth = 0;
  let inString = false;
  let escape = false;
  
  for (let i = start; i < content.length; i++) {
    const char = content[i];
    
    if (escape) { escape = false; continue; }
    if (char === '\\') { escape = true; continue; }
    if (char === '"') { inString = !inString; continue; }
    if (inString) continue;
    
    if (char === '{') depth++;
    if (char === '}') {
      depth--;
      if (depth === 0) {
        return content.substring(start, i + 1);
      }
    }
  }
  return null;
}

/**
 * Robust JSON extraction with multiple fallback methods
 */
function extractJSON(content: string): object | null {
  // Priority 1: Extract from ```json ... ``` or ``` ... ``` blocks
  const backtickMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (backtickMatch) {
    try {
      const parsed = JSON.parse(backtickMatch[1].trim());
      console.log("JSON extracted via backtick method");
      return parsed;
    } catch (e) {
      console.warn("Backtick JSON parse failed, trying fallback");
    }
  }
  
  // Priority 2: Balanced brace extraction (handles nested objects correctly)
  const balanced = extractBalancedBraces(content);
  if (balanced) {
    try {
      const parsed = JSON.parse(balanced);
      console.log("JSON extracted via balanced braces method");
      return parsed;
    } catch (e) {
      console.warn("Balanced braces parse failed, trying fallback");
    }
  }
  
  // Priority 3: Original regex fallback
  const simpleMatch = content.match(/\{[\s\S]*\}/);
  if (simpleMatch) {
    try {
      const parsed = JSON.parse(simpleMatch[0]);
      console.log("JSON extracted via simple regex fallback");
      return parsed;
    } catch (e) {
      console.error("All JSON extraction methods failed");
    }
  }
  
  return null;
}

/**
 * Validate that the extracted result has required fields
 */
function validateExtractionResult(parsed: any): boolean {
  if (!parsed || typeof parsed !== 'object') return false;
  
  // Must have legs array
  if (!Array.isArray(parsed.legs)) return false;
  
  // Each leg must have description and odds
  for (const leg of parsed.legs) {
    if (typeof leg.description !== 'string' || typeof leg.odds !== 'string') {
      return false;
    }
  }
  
  return true;
}

/**
 * Parse game time string to ISO 8601 format
 */
function parseGameTime(timeStr: string | null | undefined): string | null {
  if (!timeStr) return null;
  
  try {
    const now = new Date();
    const currentYear = now.getFullYear();
    let dateStr = timeStr.trim();
    
    // Handle relative dates
    if (/^today/i.test(dateStr)) {
      const timeMatch = dateStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
      if (timeMatch) {
        const [, hours, minutes, ampm] = timeMatch;
        let h = parseInt(hours);
        if (ampm?.toUpperCase() === 'PM' && h !== 12) h += 12;
        if (ampm?.toUpperCase() === 'AM' && h === 12) h = 0;
        now.setHours(h, parseInt(minutes), 0, 0);
        return now.toISOString();
      }
    }
    
    if (/^tomorrow/i.test(dateStr)) {
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      const timeMatch = dateStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
      if (timeMatch) {
        const [, hours, minutes, ampm] = timeMatch;
        let h = parseInt(hours);
        if (ampm?.toUpperCase() === 'PM' && h !== 12) h += 12;
        if (ampm?.toUpperCase() === 'AM' && h === 12) h = 0;
        tomorrow.setHours(h, parseInt(minutes), 0, 0);
        return tomorrow.toISOString();
      }
    }
    
    // Remove timezone abbreviations for parsing, but note them
    const tzMatch = dateStr.match(/\b(EST|EDT|CST|CDT|MST|MDT|PST|PDT|ET|CT|MT|PT)\b/i);
    const cleanedStr = dateStr.replace(/\b(EST|EDT|CST|CDT|MST|MDT|PST|PDT|ET|CT|MT|PT)\b/gi, '').trim();
    
    // Common formats: "Nov 28, 2024 7:00 PM", "11/28 19:00", "11/28/24 7:00 PM"
    const formats = [
      // "Nov 28, 2024 7:00 PM" or "November 28, 2024 7:00 PM"
      /^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)?$/i,
      // "Nov 28 7:00 PM" (no year)
      /^([A-Za-z]+)\s+(\d{1,2})\s+(\d{1,2}):(\d{2})\s*(AM|PM)?$/i,
      // "11/28/24 7:00 PM" or "11/28/2024 7:00 PM"
      /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\s+(\d{1,2}):(\d{2})\s*(AM|PM)?$/i,
      // "11/28 19:00" (24hr format)
      /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\s+(\d{1,2}):(\d{2})$/i,
    ];
    
    for (const pattern of formats) {
      const match = cleanedStr.match(pattern);
      if (match) {
        let year = currentYear;
        let month: number;
        let day: number;
        let hours: number;
        let minutes: number;
        
        // Parse based on which pattern matched
        if (pattern === formats[0]) {
          // "Nov 28, 2024 7:00 PM"
          const monthNames = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
          month = monthNames.findIndex(m => match[1].toLowerCase().startsWith(m));
          if (month === -1) continue;
          day = parseInt(match[2]);
          year = parseInt(match[3]);
          hours = parseInt(match[4]);
          minutes = parseInt(match[5]);
          const ampm = match[6];
          if (ampm?.toUpperCase() === 'PM' && hours !== 12) hours += 12;
          if (ampm?.toUpperCase() === 'AM' && hours === 12) hours = 0;
        } else if (pattern === formats[1]) {
          // "Nov 28 7:00 PM" (no year)
          const monthNames = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
          month = monthNames.findIndex(m => match[1].toLowerCase().startsWith(m));
          if (month === -1) continue;
          day = parseInt(match[2]);
          hours = parseInt(match[3]);
          minutes = parseInt(match[4]);
          const ampm = match[5];
          if (ampm?.toUpperCase() === 'PM' && hours !== 12) hours += 12;
          if (ampm?.toUpperCase() === 'AM' && hours === 12) hours = 0;
        } else {
          // Numeric date formats
          month = parseInt(match[1]) - 1; // 0-indexed
          day = parseInt(match[2]);
          if (match[3]) {
            year = parseInt(match[3]);
            if (year < 100) year += 2000; // Handle 2-digit years
          }
          hours = parseInt(match[4]);
          minutes = parseInt(match[5]);
          const ampm = match[6];
          if (ampm?.toUpperCase() === 'PM' && hours !== 12) hours += 12;
          if (ampm?.toUpperCase() === 'AM' && hours === 12) hours = 0;
        }
        
        const date = new Date(year, month, day, hours, minutes, 0, 0);
        if (!isNaN(date.getTime())) {
          return date.toISOString();
        }
      }
    }
    
    // Last resort: try native Date parsing
    const nativeDate = new Date(timeStr);
    if (!isNaN(nativeDate.getTime())) {
      return nativeDate.toISOString();
    }
    
    return null;
  } catch (e) {
    console.warn(`Failed to parse game time "${timeStr}":`, e);
    return null;
  }
}

/**
 * Compare two ISO date strings and return the earlier one
 */
function getEarlierDate(date1: string | null, date2: string | null): string | null {
  if (!date1) return date2;
  if (!date2) return date1;
  
  try {
    const d1 = new Date(date1);
    const d2 = new Date(date2);
    return d1 < d2 ? date1 : date2;
  } catch {
    return date1;
  }
}

// ============= MAIN HANDLER =============

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { 
      imageBase64, 
      frames,
      batchSize: requestedBatchSize,
      batchDelay: requestedBatchDelay 
    } = body;
    
    // Configurable batch parameters with sensible defaults and limits
    const batchSize = Math.min(Math.max(requestedBatchSize || 3, 1), 10);
    const batchDelay = Math.min(Math.max(requestedBatchDelay || 500, 100), 2000);
    
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

    console.log(`Processing ${imagesToProcess.length} image(s) with batchSize=${batchSize}, batchDelay=${batchDelay}ms...`);

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
1. All individual legs with their descriptions, odds, and game date/time
2. The TOTAL PARLAY ODDS if shown on the slip (look for total odds, combined odds, or parlay odds)
3. The STAKE/WAGER amount if visible (the amount being bet)
4. The POTENTIAL PAYOUT or "To Win" amount if visible
5. The EARLIEST game date/time from all legs (for when the parlay starts)

For individual legs, extract:
- The description (team name, player name, bet type like "ML", "Over/Under", spread, etc.)
- The odds for THAT SPECIFIC LEG - can be American (+150, -110), Decimal (2.50, 1.91), or Fractional (3/2, 5/1)
- The game date/time if visible

IMPORTANT ODDS FORMAT:
- Detect the odds format used on the slip (American, Decimal, or Fractional)
- American odds: +150, -110, +250 (starts with + or -)
- Decimal odds: 2.50, 1.91, 3.00 (just a decimal number, typically 1.01 to 100)
- Fractional odds: 3/2, 5/1, 1/4 (number/number format)
- Return the odds exactly as shown on the slip
- Set "oddsFormat" to indicate which format the slip uses

IMPORTANT: 
- The TOTAL ODDS is different from individual leg odds - it's the combined odds for the entire parlay
- Look for labels like "Total Odds", "Parlay Odds", "Combined", or just a prominently displayed odds value
- For stake, look for "Wager", "Stake", "Bet Amount", or dollar amounts
- For payout, look for "To Win", "Potential Payout", "Returns", etc.
- If this doesn't look like a betting slip at all, return isBettingSlip: false

Return ONLY valid JSON wrapped in triple backticks:
\`\`\`json
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
  "oddsFormat": "american",
  "isBettingSlip": true
}
\`\`\`

Rules:
- Set isBettingSlip to false if the image doesn't appear to be a betting slip
- Set oddsFormat to "american", "decimal", or "fractional" based on how odds appear on the slip
- Set totalOdds, stake, potentialPayout, or earliestGameTime to null if not clearly visible
- Set individual leg gameTime to null if not visible for that leg
- For stake and potentialPayout, just use the number without currency symbols
- For game times, include timezone if visible, otherwise assume local time
- earliestGameTime should be the soonest game time from all legs
- Keep leg descriptions concise
- If you cannot read the image clearly or it's not a betting slip, return: {"legs": [], "totalOdds": null, "stake": null, "potentialPayout": null, "earliestGameTime": null, "oddsFormat": null, "isBettingSlip": false}`;

    // Process all images and collect results
    const allResults: ExtractionResult[] = [];
    let framesWithSlips = 0;
    let detectedOddsFormat: 'american' | 'decimal' | 'fractional' | null = null;
    
    // For video frames, use configurable batch size
    const effectiveBatchSize = imagesToProcess.length > 1 ? batchSize : 1;
    
    for (let i = 0; i < imagesToProcess.length; i += effectiveBatchSize) {
      const batch = imagesToProcess.slice(i, i + effectiveBatchSize);
      
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
                        ? `This is frame ${imageIndex + 1} from a screen recording. Extract any betting slip information visible. Return only JSON wrapped in triple backticks.`
                        : "Extract all parlay information from this betting slip image. Return only the JSON wrapped in triple backticks."
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
              throw new Error("Rate limit exceeded");
            }
            if (response.status === 402) {
              throw new Error("AI usage limit reached");
            }
            return null;
          }

          const data = await response.json();
          const content = data.choices?.[0]?.message?.content || "{}";
          
          // Use robust JSON extraction
          const parsed = extractJSON(content);
          
          if (parsed && validateExtractionResult(parsed)) {
            const typedParsed = parsed as any;
            
            // Only count frames that actually have betting slip content
            if (typedParsed.isBettingSlip !== false && typedParsed.legs && typedParsed.legs.length > 0) {
              framesWithSlips++;
              
              // Detect odds format from the parsed data or from the first leg
              const reportedFormat = typedParsed.oddsFormat || null;
              const firstLegOdds = typedParsed.legs[0]?.odds || '';
              const detectedFormat = reportedFormat || detectOddsFormat(firstLegOdds);
              
              if (!detectedOddsFormat && detectedFormat) {
                detectedOddsFormat = detectedFormat;
              }
              
              // Process legs: convert odds to American and parse game times
              const processedLegs: ExtractedLeg[] = typedParsed.legs.map((leg: any) => {
                const legOddsFormat = detectOddsFormat(leg.odds);
                const americanOdds = convertToAmericanOdds(leg.odds, legOddsFormat);
                const gameTimeISO = parseGameTime(leg.gameTime);
                
                return {
                  description: leg.description,
                  odds: americanOdds,
                  gameTime: leg.gameTime || null,
                  gameTimeISO
                };
              });
              
              // Parse earliest game time
              const earliestGameTimeISO = parseGameTime(typedParsed.earliestGameTime);
              
              return {
                legs: processedLegs,
                totalOdds: typedParsed.totalOdds || null,
                stake: parseNumericValue(typedParsed.stake),
                potentialPayout: parseNumericValue(typedParsed.potentialPayout),
                earliestGameTime: typedParsed.earliestGameTime || null,
                earliestGameTimeISO,
                isBettingSlip: true,
                originalOddsFormat: detectedFormat
              } as ExtractionResult;
            }
          }
          
          return null;
        } catch (err) {
          console.error(`Error processing image ${imageIndex + 1}:`, err);
          if (err instanceof Error && (err.message.includes("Rate limit") || err.message.includes("usage limit"))) {
            throw err;
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
      
      // Configurable delay between batches for video frames
      if (imagesToProcess.length > 1 && i + effectiveBatchSize < imagesToProcess.length) {
        await new Promise(r => setTimeout(r, batchDelay));
      }
    }

    console.log(`Found betting slip content in ${framesWithSlips}/${imagesToProcess.length} frames`);

    // Merge all results, deduplicating legs
    const mergedResult: ExtractionResult = {
      legs: [],
      totalOdds: null,
      stake: null,
      potentialPayout: null,
      earliestGameTime: null,
      earliestGameTimeISO: null,
      isBettingSlip: framesWithSlips > 0,
      originalOddsFormat: detectedOddsFormat
    };

    const seenLegs = new Set<string>();
    let earliestISO: string | null = null;

    for (const result of allResults) {
      // Add unique legs
      for (const leg of result.legs) {
        // Create a normalized key for deduplication
        const legKey = `${leg.description.toLowerCase().replace(/\s+/g, ' ').trim()}|${leg.odds}`;
        if (!seenLegs.has(legKey)) {
          seenLegs.add(legKey);
          mergedResult.legs.push(leg);
          
          // Track earliest game time from all legs
          if (leg.gameTimeISO) {
            earliestISO = getEarlierDate(earliestISO, leg.gameTimeISO);
          }
        }
      }
      
      // Take first non-null values for other fields
      if (!mergedResult.totalOdds && result.totalOdds) mergedResult.totalOdds = result.totalOdds;
      if (mergedResult.stake === null && result.stake !== null) mergedResult.stake = result.stake;
      if (mergedResult.potentialPayout === null && result.potentialPayout !== null) mergedResult.potentialPayout = result.potentialPayout;
      if (!mergedResult.earliestGameTime && result.earliestGameTime) mergedResult.earliestGameTime = result.earliestGameTime;
      if (!mergedResult.earliestGameTimeISO && result.earliestGameTimeISO) {
        mergedResult.earliestGameTimeISO = result.earliestGameTimeISO;
      }
    }
    
    // Use calculated earliest if we have leg times but no explicit earliestGameTimeISO
    if (!mergedResult.earliestGameTimeISO && earliestISO) {
      mergedResult.earliestGameTimeISO = earliestISO;
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
