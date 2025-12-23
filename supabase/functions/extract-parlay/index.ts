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
 * Relaxed validation: allows "N/A" odds for SGP slips when totalOdds is present
 */
function validateExtractionResult(parsed: any): boolean {
  if (!parsed || typeof parsed !== 'object') return false;
  
  // Must have legs array
  if (!Array.isArray(parsed.legs)) return false;
  
  // Must have at least one leg
  if (parsed.legs.length === 0) return false;
  
  // Check if we have totalOdds (allows relaxed individual odds validation)
  const hasTotalOdds = parsed.totalOdds && parsed.totalOdds !== 'null' && parsed.totalOdds !== 'N/A';
  
  // Each leg must have description, odds can be "N/A" if totalOdds exists
  for (const leg of parsed.legs) {
    if (typeof leg.description !== 'string' || !leg.description.trim()) {
      console.log(`[Validation] Leg missing description:`, leg);
      return false;
    }
    // Odds must be a string, but can be "N/A" if we have totalOdds
    if (typeof leg.odds !== 'string') {
      console.log(`[Validation] Leg odds not a string:`, leg);
      return false;
    }
    // If no totalOdds, each leg must have actual odds
    if (!hasTotalOdds && (leg.odds === 'N/A' || !leg.odds.trim())) {
      console.log(`[Validation] Leg missing odds and no totalOdds:`, leg);
      return false;
    }
  }
  
  return true;
}

/**
 * Estimate individual leg odds from total odds when legs have N/A odds
 * Uses geometric distribution assuming roughly equal contribution
 */
function estimateLegOdds(legs: any[], totalOdds: string | null): any[] {
  if (!totalOdds) return legs;
  
  // Count legs that need estimation
  const legsNeedingOdds = legs.filter(leg => !leg.odds || leg.odds === 'N/A');
  if (legsNeedingOdds.length === 0) return legs;
  
  // Parse total odds to get implied probability
  const totalOddsStr = totalOdds.toString().trim();
  let totalImpliedProb: number;
  
  try {
    // Convert total odds to probability
    if (totalOddsStr.startsWith('+')) {
      const odds = parseInt(totalOddsStr.substring(1));
      totalImpliedProb = 100 / (odds + 100);
    } else if (totalOddsStr.startsWith('-')) {
      const odds = Math.abs(parseInt(totalOddsStr.substring(1)));
      totalImpliedProb = odds / (odds + 100);
    } else {
      // Decimal odds
      const decimal = parseFloat(totalOddsStr);
      if (decimal > 1) {
        totalImpliedProb = 1 / decimal;
      } else {
        return legs; // Invalid odds
      }
    }
  } catch {
    console.log(`[OddsEstimation] Failed to parse totalOdds: ${totalOdds}`);
    return legs;
  }
  
  // Estimate individual leg probability (geometric mean)
  const numLegs = legs.length;
  const avgLegProb = Math.pow(totalImpliedProb, 1 / numLegs);
  
  // Convert back to American odds
  let estimatedOdds: string;
  if (avgLegProb >= 0.5) {
    // Favorite: negative odds
    estimatedOdds = `-${Math.round((avgLegProb / (1 - avgLegProb)) * 100)}`;
  } else {
    // Underdog: positive odds
    estimatedOdds = `+${Math.round(((1 - avgLegProb) / avgLegProb) * 100)}`;
  }
  
  console.log(`[OddsEstimation] Total odds ${totalOdds} → ${numLegs} legs → estimated per-leg: ${estimatedOdds}`);
  
  // Apply estimated odds to legs that need them
  return legs.map(leg => {
    if (!leg.odds || leg.odds === 'N/A') {
      return { ...leg, odds: estimatedOdds, oddsEstimated: true };
    }
    return leg;
  });
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
  // DETAILED LOGGING: Log the full raw AI response for debugging
  console.log(`[ProcessResponse] ====== RAW AI RESPONSE START ======`);
  console.log(content);
  console.log(`[ProcessResponse] ====== RAW AI RESPONSE END ======`);
  
  const parsed = extractJSON(content);
  
  if (!parsed) {
    console.log(`[ProcessResponse] FAILED: Could not extract JSON from AI response`);
    return null;
  }
  
  // DETAILED LOGGING: Log the full extracted JSON before validation
  console.log(`[ProcessResponse] ====== EXTRACTED JSON START ======`);
  console.log(JSON.stringify(parsed, null, 2));
  console.log(`[ProcessResponse] ====== EXTRACTED JSON END ======`);
  
  const typedParsed = parsed as any;
  
  // Log key fields for debugging
  console.log(`[ProcessResponse] isBettingSlip: ${typedParsed.isBettingSlip}`);
  console.log(`[ProcessResponse] legs count: ${typedParsed.legs?.length || 0}`);
  console.log(`[ProcessResponse] totalOdds: ${typedParsed.totalOdds}`);
  
  if (!validateExtractionResult(parsed)) {
    console.log(`[ProcessResponse] FAILED: Validation failed for parsed result`);
    console.log(`[ProcessResponse] Validation details: legs=${typedParsed.legs?.length}, isBettingSlip=${typedParsed.isBettingSlip}`);
    return null;
  }
  
  if (typedParsed.isBettingSlip !== false && typedParsed.legs && typedParsed.legs.length > 0) {
    const reportedFormat = typedParsed.oddsFormat || null;
    
    // Find first leg with actual odds for format detection
    const firstLegWithOdds = typedParsed.legs.find((leg: any) => leg.odds && leg.odds !== 'N/A');
    const firstLegOdds = firstLegWithOdds?.odds || typedParsed.totalOdds || '';
    const detectedFormat = reportedFormat || detectOddsFormat(firstLegOdds);
    
    if (!detectedOddsFormatRef.value && detectedFormat) {
      detectedOddsFormatRef.value = detectedFormat;
    }
    
    // Estimate odds for legs with N/A if we have totalOdds
    const legsWithEstimatedOdds = estimateLegOdds(typedParsed.legs, typedParsed.totalOdds);
    
    const processedLegs: ExtractedLeg[] = legsWithEstimatedOdds.map((leg: any) => {
      let americanOdds = leg.odds;
      
      // Only convert if not N/A and not already estimated
      if (leg.odds && leg.odds !== 'N/A') {
        const legOddsFormat = detectOddsFormat(leg.odds);
        americanOdds = convertToAmericanOdds(leg.odds, legOddsFormat);
      }
      
      const gameTimeISO = parseGameTime(leg.gameTime);
      
      return {
        description: leg.description,
        odds: americanOdds,
        gameTime: leg.gameTime || null,
        gameTimeISO
      };
    });
    
    const earliestGameTimeISO = parseGameTime(typedParsed.earliestGameTime);
    
    console.log(`[ProcessResponse] SUCCESS: Processed ${processedLegs.length} legs, totalOdds: ${typedParsed.totalOdds}`);
    
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
  
  console.log(`[ProcessResponse] FAILED: isBettingSlip=${typedParsed.isBettingSlip}, legs=${typedParsed.legs?.length || 0}`);
  return null;
}

// ============= EXTRACTION FUNCTIONS =============

const systemPrompt = `You are an expert at reading betting slips from FanDuel, DraftKings, BetMGM, and other sportsbooks.
Your job is to extract parlay/SGP information from betting slip images.

CRITICAL - RECOGNIZING FANDUEL/DRAFTKINGS BETTING SLIPS:
The following UI elements indicate a BETTING SLIP (isBettingSlip: true):
- "Betslip" header or tab at the top of the screen
- "Same Game Parlay" or "SGP" badge (often yellow/orange)
- "Parlay" label
- A list of player props or selections with checkmarks or indicators
- Individual picks like "Player Name Over/Under X.5 Points/Rebounds/Assists"
- A "Place Bet" or "Add to Betslip" button
- Total odds displayed prominently (e.g., "+1018", "+2456", "+892")
- Stake input field or wager amount
- "Potential Payout" or "To Win" amount

FANDUEL SPECIFIC UI PATTERNS:
- Blue/white interface with "Betslip" tab
- Yellow "SGP" badge for Same Game Parlays
- Player props listed as "Player Name - Over/Under X.5 Stat Type"
- Legs shown with player photos and prop details
- Total odds shown at bottom near "Place Bet" button

DRAFTKINGS SPECIFIC UI PATTERNS:
- Dark theme interface
- "Bet Slip" header
- "SGP" or "PARLAY" labels
- Similar player prop format

WHAT IS NOT A BETTING SLIP (isBettingSlip: false):
- Sportsbook homepage showing games/matches
- Live scores or game schedules
- Menu navigation screens
- Account/settings pages
- Promotional banners
- Loading screens

CRITICAL EXTRACTION RULES:
1. If you see ANY betting slip UI elements listed above, set isBettingSlip: true
2. Extract ALL visible legs/picks even if individual odds are not shown
3. For SGP slips, individual leg odds are often NOT displayed - use "N/A" for individual odds
4. ALWAYS extract the TOTAL combined odds (the prominent odds display like "+1018")
5. Extract stake and potential payout if visible

For each leg, extract:
- description: The full pick (e.g., "Jayson Tatum Over 26.5 Points")
- odds: Individual leg odds if visible, otherwise "N/A"
- gameTime: Game date/time if visible

IMPORTANT ODDS FORMAT:
- American odds: +150, -110, +1018 (starts with + or -)
- Decimal odds: 2.50, 1.91 (decimal number)
- Fractional odds: 3/2, 5/1 (number/number)
- Return odds exactly as shown, set "oddsFormat" accordingly

Return ONLY valid JSON wrapped in triple backticks:
\`\`\`json
{
  "legs": [
    {"description": "Jayson Tatum Over 26.5 Points", "odds": "N/A", "gameTime": "Dec 21, 2024 7:00 PM EST"},
    {"description": "Jaylen Brown Over 5.5 Assists", "odds": "N/A", "gameTime": null}
  ],
  "totalOdds": "+1018",
  "stake": "25.00",
  "potentialPayout": "279.50",
  "earliestGameTime": "Dec 21, 2024 7:00 PM EST",
  "oddsFormat": "american",
  "isBettingSlip": true
}
\`\`\`

If the image is clearly NOT a betting slip (homepage, navigation, scores), return:
\`\`\`json
{"legs": [], "totalOdds": null, "stake": null, "potentialPayout": null, "earliestGameTime": null, "oddsFormat": null, "isBettingSlip": false}
\`\`\``;

// Explicit retry prompt for when first attempt fails
const retryPrompt = `This IS a FanDuel/DraftKings betting slip screenshot. I can see it has player props or selections.
Please extract ALL the betting information. Look for:
- The "Betslip" or "SGP" indicator
- Each player pick/prop (e.g., "Player Over X.5 Points")
- The total combined odds (like +1018)
- Any stake or payout amounts

Even if individual leg odds are not shown, extract each leg description.
Return ONLY the JSON wrapped in triple backticks.`;

/**
 * Extract parlay using OpenAI Vision API (PRIMARY - using gpt-4o for better vision)
 */
async function extractWithOpenAI(
  imageData: string,
  openAIKey: string,
  imageIndex: number,
  totalImages: number,
  detectedOddsFormatRef: { value: 'american' | 'decimal' | 'fractional' | null },
  isRetry: boolean = false
): Promise<ExtractionResult | null> {
  const model = "gpt-4o"; // Upgraded from gpt-4o-mini for better vision recognition
  console.log(`[OpenAI] Processing image ${imageIndex + 1}/${totalImages} with ${model}${isRetry ? ' (RETRY)' : ''}...`);
  
  const userPrompt = isRetry 
    ? retryPrompt 
    : (totalImages > 1 
        ? `This is frame ${imageIndex + 1} from a screen recording. Extract any betting slip information visible. Return only JSON wrapped in triple backticks.`
        : "Extract all parlay information from this betting slip image. Return only the JSON wrapped in triple backticks.");
  
  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${openAIKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: model,
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: [
              { 
                type: "text", 
                text: userPrompt
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
        console.log("[OpenAI] Rate limited, will try with gpt-4o-mini...");
        // Fallback to gpt-4o-mini if rate limited on gpt-4o
        return await extractWithOpenAIMini(imageData, openAIKey, imageIndex, totalImages, detectedOddsFormatRef);
      }
      
      // Return structured error for rate limiting on all requests
      if (response.status >= 500) {
        throw new Error(`AI service temporarily unavailable (${response.status})`);
      }
      return null;
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "{}";
    
    console.log(`[OpenAI] Raw response length: ${content.length} chars`);
    
    const result = processExtractionResponse(content, detectedOddsFormatRef);
    
    if (result) {
      console.log(`[OpenAI] Image ${imageIndex + 1}: Found ${result.legs.length} legs`);
      return result;
    } else {
      console.log(`[OpenAI] Image ${imageIndex + 1}: No betting slip found`);
      
      // If first attempt failed and not already a retry, try with explicit prompt
      if (!isRetry) {
        console.log(`[OpenAI] Image ${imageIndex + 1}: Retrying with explicit betting slip prompt...`);
        return await extractWithOpenAI(imageData, openAIKey, imageIndex, totalImages, detectedOddsFormatRef, true);
      }
      
      return null;
    }
  } catch (err) {
    console.error(`[OpenAI] Error processing image ${imageIndex + 1}:`, err);
    throw err;
  }
}

/**
 * Fallback to gpt-4o-mini if gpt-4o is rate limited
 */
async function extractWithOpenAIMini(
  imageData: string,
  openAIKey: string,
  imageIndex: number,
  totalImages: number,
  detectedOddsFormatRef: { value: 'american' | 'decimal' | 'fractional' | null }
): Promise<ExtractionResult | null> {
  console.log(`[OpenAI-Mini] Processing image ${imageIndex + 1}/${totalImages}...`);
  
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
                text: retryPrompt // Use explicit prompt for mini model
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
      console.error(`[OpenAI-Mini] Image ${imageIndex + 1} error:`, response.status, errorText);
      return null;
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "{}";
    
    return processExtractionResponse(content, detectedOddsFormatRef);
  } catch (err) {
    console.error(`[OpenAI-Mini] Error processing image ${imageIndex + 1}:`, err);
    return null;
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
  detectedOddsFormatRef: { value: 'american' | 'decimal' | 'fractional' | null },
  isRetry: boolean = false
): Promise<ExtractionResult | null> {
  console.log(`[Gemini] Processing image ${imageIndex + 1}/${totalImages}${isRetry ? ' (RETRY)' : ''}...`);
  
  const userPrompt = isRetry 
    ? retryPrompt 
    : (totalImages > 1 
        ? `This is frame ${imageIndex + 1} from a screen recording. Extract any betting slip information visible. Return only JSON wrapped in triple backticks.`
        : "Extract all parlay information from this betting slip image. Return only the JSON wrapped in triple backticks.");
  
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
                text: userPrompt
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
    
    console.log(`[Gemini] Raw response length: ${content.length} chars`);
    
    const result = processExtractionResponse(content, detectedOddsFormatRef);
    
    if (result) {
      console.log(`[Gemini] Image ${imageIndex + 1}: Found ${result.legs.length} legs`);
      return result;
    } else {
      console.log(`[Gemini] Image ${imageIndex + 1}: No betting slip found`);
      
      // If first attempt failed and not already a retry, try with explicit prompt
      if (!isRetry) {
        console.log(`[Gemini] Image ${imageIndex + 1}: Retrying with explicit betting slip prompt...`);
        return await extractWithGemini(imageData, lovableApiKey, imageIndex, totalImages, detectedOddsFormatRef, true);
      }
      
      return null;
    }
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
    
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    
    // Check if it's a rate limit error and return structured response
    if (errorMessage.toLowerCase().includes('rate') || errorMessage.includes('429') || errorMessage.includes('too many')) {
      return new Response(
        JSON.stringify({ 
          error: 'rate_limited',
          rateLimited: true,
          retryAfter: 30,
          message: 'High demand - please try again in a moment'
        }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
