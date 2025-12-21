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

/**
 * Process extraction response and return result
 */
function processExtractionResponse(content: string, detectedOddsFormatRef: { value: 'american' | 'decimal' | 'fractional' | null }): ExtractionResult | null {
  const parsed = extractJSON(content);
  
  if (parsed && validateExtractionResult(parsed)) {
    const typedParsed = parsed as any;
    
    if (typedParsed.isBettingSlip !== false && typedParsed.legs && typedParsed.legs.length > 0) {
      const reportedFormat = typedParsed.oddsFormat || null;
      const firstLegOdds = typedParsed.legs[0]?.odds || '';
      const detectedFormat = reportedFormat || detectOddsFormat(firstLegOdds);
      
      if (!detectedOddsFormatRef.value && detectedFormat) {
        detectedOddsFormatRef.value = detectedFormat;
      }
      
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
      };
    }
  }
  
  return null;
}

// ============= EXTRACTION FUNCTIONS =============

const systemPrompt = `You are an expert at reading betting slips and sports betting parlays. 
Your job is to extract parlay information from betting slip images.

CRITICAL - CONTENT TYPE DETECTION:
First, determine what type of content you're looking at:
1. BETTING SLIP: Shows a parlay/bet with legs, odds, stake amount. Has labels like "Parlay", "Same Game Parlay", "Bet Slip", "Wager", team names with odds.
2. APP NAVIGATION: Shows sportsbook homepage, menus, game listings, live scores, account pages, settings, promotions - these are NOT betting slips.
3. OTHER: Loading screens, blank screens, unclear images, non-sports content.

For screen recordings/video frames:
- MOST frames will show app navigation, menus, or loading screens - these are NOT betting slips
- Only extract betting slip data from frames that CLEARLY show a placed parlay/bet slip with visible legs and odds
- If a frame shows: sportsbook homepage, game listings, live scores, menus, promotions, account settings - return isBettingSlip: false
- A betting slip typically shows: "Parlay" or "SGP" label, multiple legs with team/player names AND odds, stake/wager amount, potential payout

WHAT TO EXTRACT (only from actual betting slips):
1. All individual legs with their descriptions, odds, and game date/time
2. The TOTAL PARLAY ODDS if shown (look for "Total Odds", "Combined", or prominent odds display)
3. The STAKE/WAGER amount if visible
4. The POTENTIAL PAYOUT or "To Win" amount if visible
5. The EARLIEST game date/time from all legs

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
- Set isBettingSlip to FALSE if the image shows app navigation, menus, homepages, game listings, or anything that is NOT a betting slip
- Set isBettingSlip to FALSE if you cannot clearly identify it as a placed bet/parlay
- Set oddsFormat to "american", "decimal", or "fractional" based on how odds appear on the slip
- Set totalOdds, stake, potentialPayout, or earliestGameTime to null if not clearly visible
- Set individual leg gameTime to null if not visible for that leg
- For stake and potentialPayout, just use the number without currency symbols
- For game times, include timezone if visible, otherwise assume local time
- earliestGameTime should be the soonest game time from all legs
- Keep leg descriptions concise
- If you cannot read the image clearly or it's not a betting slip, return: {"legs": [], "totalOdds": null, "stake": null, "potentialPayout": null, "earliestGameTime": null, "oddsFormat": null, "isBettingSlip": false}`;

/**
 * Extract parlay using OpenAI Vision API (PRIMARY - faster)
 */
async function extractWithOpenAI(
  imageData: string,
  openAIKey: string,
  imageIndex: number,
  totalImages: number,
  detectedOddsFormatRef: { value: 'american' | 'decimal' | 'fractional' | null }
): Promise<ExtractionResult | null> {
  console.log(`[OpenAI] Processing image ${imageIndex + 1}/${totalImages}...`);
  
  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${openAIKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: [
              { 
                type: "text", 
                text: totalImages > 1 
                  ? `This is frame ${imageIndex + 1} from a screen recording. Extract any betting slip information visible. Return only JSON wrapped in triple backticks.`
                  : "Extract all parlay information from this betting slip image. Return only the JSON wrapped in triple backticks." 
              },
              {
                type: "image_url",
                image_url: {
                  url: imageData.startsWith("data:") ? imageData : `data:image/jpeg;base64,${imageData}`,
                  detail: "high"
                }
              }
            ]
          }
        ],
        max_tokens: 2000
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[OpenAI] Image ${imageIndex + 1} error:`, response.status, errorText);
      
      if (response.status === 429) {
        console.log("[OpenAI] Rate limited");
        throw new Error("OpenAI rate limit exceeded");
      }
      return null;
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "{}";
    
    const result = processExtractionResponse(content, detectedOddsFormatRef);
    
    if (result) {
      console.log(`[OpenAI] Image ${imageIndex + 1}: Found ${result.legs.length} legs`);
    } else {
      console.log(`[OpenAI] Image ${imageIndex + 1}: No betting slip found`);
    }
    
    return result;
  } catch (err) {
    console.error(`[OpenAI] Error processing image ${imageIndex + 1}:`, err);
    throw err;
  }
}

/**
 * Extract parlay using Gemini via Lovable AI Gateway (FALLBACK)
 */
async function extractWithGemini(
  imageData: string,
  lovableApiKey: string,
  imageIndex: number,
  totalImages: number,
  detectedOddsFormatRef: { value: 'american' | 'decimal' | 'fractional' | null }
): Promise<ExtractionResult | null> {
  console.log(`[Gemini] Processing image ${imageIndex + 1}/${totalImages}...`);
  
  try {
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${lovableApiKey}`,
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
                text: totalImages > 1 
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
      console.error(`[Gemini] Image ${imageIndex + 1} error:`, response.status, errorText);
      
      if (response.status === 429) {
        throw new Error("Gemini rate limit exceeded");
      }
      if (response.status === 402) {
        throw new Error("AI usage limit reached");
      }
      return null;
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "{}";
    
    const result = processExtractionResponse(content, detectedOddsFormatRef);
    
    if (result) {
      console.log(`[Gemini] Image ${imageIndex + 1}: Found ${result.legs.length} legs`);
    } else {
      console.log(`[Gemini] Image ${imageIndex + 1}: No betting slip found`);
    }
    
    return result;
  } catch (err) {
    console.error(`[Gemini] Error processing image ${imageIndex + 1}:`, err);
    throw err;
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
    
    // Configurable batch parameters with sensible defaults
    const batchSize = Math.min(Math.max(requestedBatchSize || 4, 1), 10);
    const batchDelay = Math.min(Math.max(requestedBatchDelay || 300, 100), 2000);
    
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

    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    
    if (!OPENAI_API_KEY && !LOVABLE_API_KEY) {
      console.error("Neither OPENAI_API_KEY nor LOVABLE_API_KEY is configured");
      return new Response(
        JSON.stringify({ error: "AI service not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Track extraction state
    const allResults: ExtractionResult[] = [];
    let framesWithSlips = 0;
    const detectedOddsFormatRef: { value: 'american' | 'decimal' | 'fractional' | null } = { value: null };
    let totalLegsFound = 0;
    const MIN_LEGS_FOR_EARLY_EXIT = 6;
    const MIN_FRAMES_FOR_EARLY_EXIT = 3;
    
    let primaryEngine: 'openai' | 'gemini' = OPENAI_API_KEY ? 'openai' : 'gemini';
    let usedFallback = false;
    
    console.log(`Using ${primaryEngine.toUpperCase()} as primary extraction engine`);

    // ============= PRIMARY EXTRACTION (OpenAI if available, else Gemini) =============
    const effectiveBatchSize = imagesToProcess.length > 1 ? batchSize : 1;
    
    for (let i = 0; i < imagesToProcess.length; i += effectiveBatchSize) {
      const batch = imagesToProcess.slice(i, i + effectiveBatchSize);
      
      const batchPromises = batch.map(async (imageData, batchIndex) => {
        const imageIndex = i + batchIndex;
        
        try {
          if (primaryEngine === 'openai' && OPENAI_API_KEY) {
            return await extractWithOpenAI(imageData, OPENAI_API_KEY, imageIndex, imagesToProcess.length, detectedOddsFormatRef);
          } else if (LOVABLE_API_KEY) {
            return await extractWithGemini(imageData, LOVABLE_API_KEY, imageIndex, imagesToProcess.length, detectedOddsFormatRef);
          }
          return null;
        } catch (err) {
          console.error(`Error in primary extraction for image ${imageIndex + 1}:`, err);
          return null;
        }
      });
      
      try {
        const batchResults = await Promise.all(batchPromises);
        batchResults.forEach(r => { 
          if (r) {
            allResults.push(r);
            framesWithSlips++;
            totalLegsFound += r.legs.length;
          }
        });
        
        // Early exit if we have enough data
        if (totalLegsFound >= MIN_LEGS_FOR_EARLY_EXIT && framesWithSlips >= MIN_FRAMES_FOR_EARLY_EXIT) {
          console.log(`Early exit: found ${totalLegsFound} legs from ${framesWithSlips} frames`);
          break;
        }
      } catch (err) {
        console.error("Batch processing error:", err);
      }
      
      // Small delay between batches
      if (imagesToProcess.length > 1 && i + effectiveBatchSize < imagesToProcess.length) {
        await new Promise(r => setTimeout(r, batchDelay));
      }
    }

    console.log(`Primary extraction (${primaryEngine}): Found ${framesWithSlips} frames with ${totalLegsFound} total legs`);

    // ============= FALLBACK EXTRACTION =============
    // If primary extraction found nothing, try the fallback engine
    if (framesWithSlips === 0 || totalLegsFound === 0) {
      const fallbackEngine = primaryEngine === 'openai' ? 'gemini' : 'openai';
      const fallbackKey = fallbackEngine === 'openai' ? OPENAI_API_KEY : LOVABLE_API_KEY;
      
      if (fallbackKey) {
        console.log(`Primary extraction found nothing, trying ${fallbackEngine.toUpperCase()} fallback...`);
        usedFallback = true;
        
        // Try first 3 frames with fallback
        const framesToTry = imagesToProcess.slice(0, 3);
        
        for (let i = 0; i < framesToTry.length; i++) {
          try {
            let result: ExtractionResult | null = null;
            
            if (fallbackEngine === 'openai' && OPENAI_API_KEY) {
              result = await extractWithOpenAI(framesToTry[i], OPENAI_API_KEY, i, framesToTry.length, detectedOddsFormatRef);
            } else if (fallbackEngine === 'gemini' && LOVABLE_API_KEY) {
              result = await extractWithGemini(framesToTry[i], LOVABLE_API_KEY, i, framesToTry.length, detectedOddsFormatRef);
            }
            
            if (result && result.legs.length > 0) {
              console.log(`Fallback (${fallbackEngine}) succeeded on frame ${i + 1} with ${result.legs.length} legs`);
              return new Response(
                JSON.stringify({
                  ...result,
                  framesProcessed: imagesToProcess.length,
                  framesWithSlips: 1,
                  fallbackUsed: fallbackEngine
                }),
                { headers: { ...corsHeaders, "Content-Type": "application/json" } }
              );
            }
          } catch (err) {
            console.error(`Fallback error on frame ${i + 1}:`, err);
          }
        }
        
        console.log(`Fallback (${fallbackEngine}) also failed to find betting slip`);
      }
    }

    // ============= MERGE RESULTS =============
    const mergedResult: ExtractionResult = {
      legs: [],
      totalOdds: null,
      stake: null,
      potentialPayout: null,
      earliestGameTime: null,
      earliestGameTimeISO: null,
      isBettingSlip: framesWithSlips > 0,
      originalOddsFormat: detectedOddsFormatRef.value
    };

    const seenLegs = new Set<string>();
    let earliestISO: string | null = null;

    for (const result of allResults) {
      // Add unique legs
      for (const leg of result.legs) {
        const legKey = `${leg.description.toLowerCase().replace(/\s+/g, ' ').trim()}|${leg.odds}`;
        if (!seenLegs.has(legKey)) {
          seenLegs.add(legKey);
          mergedResult.legs.push(leg);
          
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

    console.log(`Final result: ${mergedResult.legs.length} unique legs from ${framesWithSlips} frames`);

    return new Response(
      JSON.stringify({
        ...mergedResult,
        framesProcessed: imagesToProcess.length,
        framesWithSlips,
        fallbackUsed: usedFallback ? (primaryEngine === 'openai' ? 'gemini' : 'openai') : null,
        primaryEngine
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
