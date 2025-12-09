import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface TrackedProp {
  id: string;
  event_id: string | null;
  sport: string;
  player_name: string;
  prop_type: string;
  bookmaker: string;
  opening_line: number;
  opening_over_price: number;
  opening_under_price: number;
  current_line: number | null;
  current_over_price: number | null;
  current_under_price: number | null;
  commence_time: string | null;
  status: string;
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  // Parse request body for options
  let useOpeningFallback = false;
  let batchSize = 20;
  let prioritizeUpcoming = true;
  
  try {
    const body = await req.json();
    useOpeningFallback = body?.useOpeningFallback ?? false;
    batchSize = body?.batchSize ?? 20;
    prioritizeUpcoming = body?.prioritizeUpcoming ?? true;
  } catch {
    // No body provided, use defaults
  }

  console.log("[AUTO-REFRESH] Starting automated refresh and analyze job...");
  console.log(`[AUTO-REFRESH] Options: fallback=${useOpeningFallback}, batch=${batchSize}, prioritize=${prioritizeUpcoming}`);

  // Log job start
  const { data: jobRecord, error: jobError } = await supabase
    .from("cron_job_history")
    .insert({
      job_name: "auto-refresh-sharp-tracker",
      status: "running",
      started_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (jobError) {
    console.error("[AUTO-REFRESH] Failed to create job record:", jobError);
  }

  try {
    // Step 1: Fetch all pending props, prioritize upcoming games
    let query = supabase
      .from("sharp_line_tracker")
      .select("*")
      .eq("status", "pending");
    
    if (prioritizeUpcoming) {
      // Get games starting in next 24 hours first
      const next24Hours = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      query = query.lte("commence_time", next24Hours);
    }
    
    query = query.limit(batchSize);

    const { data: pendingProps, error: fetchError } = await query;

    if (fetchError) {
      throw new Error(`Failed to fetch pending props: ${fetchError.message}`);
    }

    console.log(`[AUTO-REFRESH] Found ${pendingProps?.length || 0} pending props to process`);

    let fetchSuccess = 0;
    let fetchFail = 0;
    let fallbackUsed = 0;
    const propsToAnalyze: TrackedProp[] = [];

    // Step 2: Fetch current odds for each prop (with fallback)
    for (const prop of (pendingProps || []) as TrackedProp[]) {
      try {
        let hasCurrentOdds = false;
        
        // Try to fetch current odds if event_id exists
        if (prop.event_id) {
          const { data: oddsData, error: oddsError } = await supabase.functions.invoke("fetch-current-odds", {
            body: {
              event_id: prop.event_id,
              sport: prop.sport,
              player_name: prop.player_name,
              prop_type: prop.prop_type,
              bookmaker: prop.bookmaker,
            },
          });

          if (!oddsError && oddsData?.success) {
            // Update the database with current odds
            await supabase
              .from("sharp_line_tracker")
              .update({
                current_over_price: oddsData.odds.over_price,
                current_under_price: oddsData.odds.under_price,
                current_line: oddsData.odds.line,
                last_updated: new Date().toISOString(),
                status: "updated",
              })
              .eq("id", prop.id);

            prop.current_over_price = oddsData.odds.over_price;
            prop.current_under_price = oddsData.odds.under_price;
            prop.current_line = oddsData.odds.line;
            hasCurrentOdds = true;
            fetchSuccess++;
          }
        }
        
        // Use opening odds as fallback if enabled and no current odds
        if (!hasCurrentOdds && useOpeningFallback) {
          console.log(`[AUTO-REFRESH] Using opening odds fallback for ${prop.player_name}`);
          
          // Update with opening odds as current
          await supabase
            .from("sharp_line_tracker")
            .update({
              current_over_price: prop.opening_over_price,
              current_under_price: prop.opening_under_price,
              current_line: prop.opening_line,
              last_updated: new Date().toISOString(),
              status: "fallback",
            })
            .eq("id", prop.id);

          prop.current_over_price = prop.opening_over_price;
          prop.current_under_price = prop.opening_under_price;
          prop.current_line = prop.opening_line;
          hasCurrentOdds = true;
          fallbackUsed++;
        }

        if (hasCurrentOdds) {
          propsToAnalyze.push(prop);
        } else {
          fetchFail++;
        }

        // Rate limit delay
        await new Promise((resolve) => setTimeout(resolve, 200));
      } catch (err) {
        console.error(`[AUTO-REFRESH] Error processing ${prop.player_name}:`, err);
        fetchFail++;
      }
    }

    console.log(`[AUTO-REFRESH] Fetch complete: ${fetchSuccess} fresh, ${fallbackUsed} fallback, ${fetchFail} failed`);

    // Step 3: Get additional props ready for analysis (already have current odds but not analyzed)
    const { data: existingPropsToAnalyze } = await supabase
      .from("sharp_line_tracker")
      .select("*")
      .not("current_over_price", "is", null)
      .not("current_under_price", "is", null)
      .is("ai_recommendation", null)
      .limit(batchSize);

    const allPropsToAnalyze = [
      ...propsToAnalyze,
      ...(existingPropsToAnalyze || []).filter(
        (p) => !propsToAnalyze.some((x) => x.id === p.id)
      ),
    ].slice(0, batchSize);

    console.log(`[AUTO-REFRESH] Total ${allPropsToAnalyze.length} props ready to analyze`);

    let analyzeSuccess = 0;
    let analyzeFail = 0;

    // Step 4: Analyze props in parallel batches
    const analyzeBatchSize = 5;
    for (let i = 0; i < allPropsToAnalyze.length; i += analyzeBatchSize) {
      const batch = allPropsToAnalyze.slice(i, i + analyzeBatchSize);
      
      const results = await Promise.allSettled(
        batch.map(async (prop: TrackedProp) => {
          const { error: analyzeError } = await supabase.functions.invoke("analyze-sharp-line", {
            body: {
              id: prop.id,
              opening_line: prop.opening_line,
              opening_over_price: prop.opening_over_price,
              opening_under_price: prop.opening_under_price,
              current_line: prop.current_line || prop.opening_line,
              current_over_price: prop.current_over_price,
              current_under_price: prop.current_under_price,
              sport: prop.sport,
              prop_type: prop.prop_type,
              commence_time: prop.commence_time,
              player_name: prop.player_name,
            },
          });

          if (analyzeError) {
            throw new Error(analyzeError.message);
          }
          return prop.player_name;
        })
      );

      for (const result of results) {
        if (result.status === "fulfilled") {
          analyzeSuccess++;
        } else {
          analyzeFail++;
          console.error("[AUTO-REFRESH] Analysis failed:", result.reason);
        }
      }

      // Small delay between batches
      await new Promise((resolve) => setTimeout(resolve, 300));
    }

    console.log(`[AUTO-REFRESH] Analyze complete: ${analyzeSuccess} success, ${analyzeFail} failed`);

    const duration = Date.now() - startTime;
    const result = {
      fetch: { 
        success: fetchSuccess, 
        fallback: fallbackUsed,
        failed: fetchFail, 
        total: pendingProps?.length || 0 
      },
      analyze: { 
        success: analyzeSuccess, 
        failed: analyzeFail, 
        total: allPropsToAnalyze.length 
      },
      options: { useOpeningFallback, batchSize, prioritizeUpcoming },
      duration_ms: duration,
    };

    // Update job record
    if (jobRecord) {
      await supabase
        .from("cron_job_history")
        .update({
          status: "completed",
          completed_at: new Date().toISOString(),
          duration_ms: duration,
          result,
        })
        .eq("id", jobRecord.id);
    }

    console.log(`[AUTO-REFRESH] Job completed in ${duration}ms:`, result);

    return new Response(JSON.stringify({ success: true, ...result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error("[AUTO-REFRESH] Job failed:", error);

    // Update job record with error
    if (jobRecord) {
      await supabase
        .from("cron_job_history")
        .update({
          status: "failed",
          completed_at: new Date().toISOString(),
          duration_ms: duration,
          error_message: error instanceof Error ? error.message : "Unknown error",
        })
        .eq("id", jobRecord.id);
    }

    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : "Unknown error" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
