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

  console.log("[AUTO-REFRESH] Starting automated refresh and analyze job...");

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
    // Step 1: Fetch all pending props with event IDs
    const { data: pendingProps, error: fetchError } = await supabase
      .from("sharp_line_tracker")
      .select("*")
      .eq("status", "pending")
      .not("event_id", "is", null);

    if (fetchError) {
      throw new Error(`Failed to fetch pending props: ${fetchError.message}`);
    }

    console.log(`[AUTO-REFRESH] Found ${pendingProps?.length || 0} pending props to refresh`);

    let fetchSuccess = 0;
    let fetchFail = 0;
    const updatedProps: TrackedProp[] = [];

    // Step 2: Fetch current odds for each prop
    for (const prop of (pendingProps || []) as TrackedProp[]) {
      try {
        const { data: oddsData, error: oddsError } = await supabase.functions.invoke("fetch-current-odds", {
          body: {
            event_id: prop.event_id,
            sport: prop.sport,
            player_name: prop.player_name,
            prop_type: prop.prop_type,
            bookmaker: prop.bookmaker,
          },
        });

        if (oddsError || !oddsData?.success) {
          console.log(`[AUTO-REFRESH] Failed to fetch odds for ${prop.player_name}: ${oddsError?.message || oddsData?.error}`);
          fetchFail++;
          continue;
        }

        // Update the database
        const { error: updateError } = await supabase
          .from("sharp_line_tracker")
          .update({
            current_over_price: oddsData.odds.over_price,
            current_under_price: oddsData.odds.under_price,
            current_line: oddsData.odds.line,
            last_updated: new Date().toISOString(),
            status: "updated",
          })
          .eq("id", prop.id);

        if (updateError) {
          console.log(`[AUTO-REFRESH] Failed to update ${prop.player_name}: ${updateError.message}`);
          fetchFail++;
        } else {
          fetchSuccess++;
          updatedProps.push({
            ...prop,
            current_over_price: oddsData.odds.over_price,
            current_under_price: oddsData.odds.under_price,
            current_line: oddsData.odds.line,
          });
        }

        // Rate limit delay
        await new Promise((resolve) => setTimeout(resolve, 300));
      } catch (err) {
        console.error(`[AUTO-REFRESH] Error processing ${prop.player_name}:`, err);
        fetchFail++;
      }
    }

    console.log(`[AUTO-REFRESH] Fetch complete: ${fetchSuccess} success, ${fetchFail} failed`);

    // Step 3: Get all props ready to analyze (including just updated ones)
    const { data: propsToAnalyze, error: analyzeQueryError } = await supabase
      .from("sharp_line_tracker")
      .select("*")
      .not("current_over_price", "is", null)
      .not("current_under_price", "is", null)
      .is("ai_recommendation", null);

    if (analyzeQueryError) {
      console.error("[AUTO-REFRESH] Failed to query props for analysis:", analyzeQueryError);
    }

    console.log(`[AUTO-REFRESH] Found ${propsToAnalyze?.length || 0} props ready to analyze`);

    let analyzeSuccess = 0;
    let analyzeFail = 0;

    // Step 4: Analyze each prop
    for (const prop of (propsToAnalyze || []) as TrackedProp[]) {
      try {
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
          },
        });

        if (analyzeError) {
          console.log(`[AUTO-REFRESH] Failed to analyze ${prop.player_name}: ${analyzeError.message}`);
          analyzeFail++;
        } else {
          analyzeSuccess++;
        }

        // Rate limit delay
        await new Promise((resolve) => setTimeout(resolve, 500));
      } catch (err) {
        console.error(`[AUTO-REFRESH] Error analyzing ${prop.player_name}:`, err);
        analyzeFail++;
      }
    }

    console.log(`[AUTO-REFRESH] Analyze complete: ${analyzeSuccess} success, ${analyzeFail} failed`);

    const duration = Date.now() - startTime;
    const result = {
      fetch: { success: fetchSuccess, failed: fetchFail, total: pendingProps?.length || 0 },
      analyze: { success: analyzeSuccess, failed: analyzeFail, total: propsToAnalyze?.length || 0 },
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
