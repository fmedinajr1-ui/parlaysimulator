import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { Resend } from "https://esm.sh/resend@2.0.0";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface LockedPick {
  player_name: string;
  prop_type: string;
  line: number;
  final_pick: string;
  over_price: number;
  under_price: number;
  final_pick_reason: string;
  final_pick_confidence: number;
  sport: string;
  game_description: string;
  commence_time: string;
}

const getConfidenceBadge = (confidence: number): { emoji: string; label: string; color: string } => {
  if (confidence >= 0.7) return { emoji: "🔥", label: "HIGH", color: "#22c55e" };
  if (confidence >= 0.5) return { emoji: "⚡", label: "MEDIUM", color: "#f59e0b" };
  return { emoji: "📊", label: "LOW", color: "#6b7280" };
};

const getSportEmoji = (sport: string): string => {
  const sportMap: Record<string, string> = {
    basketball_nba: "🏀",
    basketball_ncaab: "🏀",
    americanfootball_nfl: "🏈",
    americanfootball_ncaaf: "🏈",
    baseball_mlb: "⚾",
    icehockey_nhl: "🏒",
    soccer_epl: "⚽",
    soccer_mls: "⚽",
  };
  return sportMap[sport] || "🎯";
};

const generatePickCard = (pick: LockedPick): string => {
  const badge = getConfidenceBadge(pick.final_pick_confidence);
  const sportEmoji = getSportEmoji(pick.sport);
  const price = pick.final_pick === "over" ? pick.over_price : pick.under_price;
  const priceFormatted = price > 0 ? `+${price}` : price;
  
  return `
    <div style="background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); border-radius: 12px; padding: 20px; margin-bottom: 16px; border-left: 4px solid ${badge.color};">
      <div style="display: flex; align-items: center; margin-bottom: 12px;">
        <span style="font-size: 24px; margin-right: 10px;">${sportEmoji}</span>
        <div>
          <div style="font-size: 18px; font-weight: bold; color: #fff;">${pick.player_name}</div>
          <div style="font-size: 14px; color: #a0aec0; text-transform: capitalize;">${pick.prop_type.replace(/_/g, ' ')}</div>
        </div>
      </div>
      <div style="background: rgba(255,255,255,0.05); border-radius: 8px; padding: 12px; margin-bottom: 12px;">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <div>
            <span style="color: #a0aec0; font-size: 12px;">LINE</span>
            <div style="font-size: 20px; font-weight: bold; color: #fff;">${pick.line}</div>
          </div>
          <div style="text-align: center;">
            <span style="background: ${pick.final_pick === 'over' ? '#22c55e' : '#ef4444'}; color: #fff; padding: 6px 16px; border-radius: 20px; font-weight: bold; font-size: 14px; text-transform: uppercase;">${pick.final_pick}</span>
          </div>
          <div style="text-align: right;">
            <span style="color: #a0aec0; font-size: 12px;">ODDS</span>
            <div style="font-size: 20px; font-weight: bold; color: #fff;">${priceFormatted}</div>
          </div>
        </div>
      </div>
      <div style="display: flex; align-items: center; margin-bottom: 8px;">
        <span style="font-size: 16px; margin-right: 6px;">${badge.emoji}</span>
        <span style="color: ${badge.color}; font-weight: bold; font-size: 14px;">${badge.label} (${Math.round(pick.final_pick_confidence * 100)}%)</span>
      </div>
      <div style="color: #a0aec0; font-size: 13px; font-style: italic;">${pick.final_pick_reason}</div>
      <div style="color: #6b7280; font-size: 12px; margin-top: 8px;">${pick.game_description}</div>
    </div>
  `;
};

const generateEmailHtml = (picks: LockedPick[], appUrl: string): string => {
  const pickCards = picks.map(generatePickCard).join("");
  
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="margin: 0; padding: 0; background-color: #0f0f1a; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
      <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">
        <div style="text-align: center; margin-bottom: 32px;">
          <div style="font-size: 48px; margin-bottom: 12px;">🎯</div>
          <h1 style="color: #fff; font-size: 28px; margin: 0 0 8px 0;">FINAL PICKS LOCKED</h1>
          <p style="color: #a0aec0; font-size: 16px; margin: 0;">Games starting in 30-90 minutes</p>
        </div>
        
        <div style="background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); border-radius: 12px; padding: 16px; margin-bottom: 24px; text-align: center;">
          <span style="color: #fff; font-size: 20px; font-weight: bold;">${picks.length} Pick${picks.length > 1 ? 's' : ''} Ready</span>
        </div>
        
        ${pickCards}
        
        <div style="text-align: center; margin-top: 32px;">
          <a href="${appUrl}/suggestions" style="display: inline-block; background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); color: #fff; text-decoration: none; padding: 16px 32px; border-radius: 8px; font-weight: bold; font-size: 16px;">View All Picks →</a>
        </div>
        
        <div style="text-align: center; margin-top: 32px; padding-top: 24px; border-top: 1px solid rgba(255,255,255,0.1);">
          <p style="color: #6b7280; font-size: 12px; margin: 0;">You're receiving this because you enabled Juiced Props alerts.</p>
          <p style="color: #6b7280; font-size: 12px; margin: 8px 0 0 0;">Update preferences in your profile settings.</p>
        </div>
      </div>
    </body>
    </html>
  `;
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { picks } = await req.json() as { picks: LockedPick[] };
    
    if (!picks || picks.length === 0) {
      console.log("No picks provided");
      return new Response(JSON.stringify({ success: true, sent: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`Processing ${picks.length} locked picks for email notification`);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get users who have juiced picks email enabled and haven't been emailed in last 4 hours
    const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();
    
    const { data: subscribers, error: fetchError } = await supabase
      .from("notification_preferences")
      .select("id, email, user_id, last_juiced_email_at")
      .eq("email_notifications", true)
      .eq("juiced_picks_email", true)
      .or(`last_juiced_email_at.is.null,last_juiced_email_at.lt.${fourHoursAgo}`);

    if (fetchError) {
      console.error("Error fetching subscribers:", fetchError);
      throw fetchError;
    }

    if (!subscribers || subscribers.length === 0) {
      console.log("No eligible subscribers found");
      return new Response(JSON.stringify({ success: true, sent: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`Found ${subscribers.length} eligible subscribers`);

    const appUrl = Deno.env.get("APP_URL") || "https://parlaysimulator.com";
    const emailHtml = generateEmailHtml(picks, appUrl);
    
    let sentCount = 0;
    const errors: string[] = [];

    for (const subscriber of subscribers) {
      try {
        const { error: emailError } = await resend.emails.send({
          from: "Parlay Farmer <picks@resend.dev>",
          to: [subscriber.email],
          subject: `🎯 ${picks.length} Final Pick${picks.length > 1 ? 's' : ''} Locked - Games Starting Soon!`,
          html: emailHtml,
        });

        if (emailError) {
          console.error(`Error sending to ${subscriber.email}:`, emailError);
          errors.push(`${subscriber.email}: ${emailError.message}`);
          continue;
        }

        // Update last_juiced_email_at
        await supabase
          .from("notification_preferences")
          .update({ last_juiced_email_at: new Date().toISOString() })
          .eq("id", subscriber.id);

        sentCount++;
        console.log(`Email sent to ${subscriber.email}`);
      } catch (sendError: any) {
        console.error(`Failed to send to ${subscriber.email}:`, sendError);
        errors.push(`${subscriber.email}: ${sendError?.message || 'Unknown error'}`);
      }
    }

    console.log(`Successfully sent ${sentCount}/${subscribers.length} emails`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        sent: sentCount, 
        total: subscribers.length,
        errors: errors.length > 0 ? errors : undefined 
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error: any) {
    console.error("Error in send-juiced-picks-email:", error);
    return new Response(
      JSON.stringify({ error: error?.message || 'Unknown error' }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
