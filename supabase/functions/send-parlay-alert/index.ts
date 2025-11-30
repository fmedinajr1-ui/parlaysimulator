import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");

async function sendEmail(to: string, subject: string, html: string) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "Parlay Simulator <onboarding@resend.dev>",
      to: [to],
      subject,
      html,
    }),
  });
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Resend error: ${error}`);
  }
  
  return response.json();
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface SuggestedLeg {
  description: string;
  odds: number;
  sport: string;
  betType: string;
}

interface ParlayAlert {
  email: string;
  username?: string;
  suggestions: Array<{
    legs: SuggestedLeg[];
    total_odds: number;
    combined_probability: number;
    suggestion_reason: string;
    sport: string;
    confidence_score: number;
  }>;
}

function formatOdds(odds: number): string {
  return odds > 0 ? `+${odds}` : odds.toString();
}

function generateEmailHtml(alert: ParlayAlert): string {
  const { username, suggestions } = alert;
  const greeting = username ? `Hey ${username}` : "Hey";
  
  const parlayCards = suggestions.map((s, idx) => `
    <div style="background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); border-radius: 12px; padding: 20px; margin-bottom: 16px; border: 1px solid #0f3460;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
        <span style="color: #00d9ff; font-weight: bold; font-size: 14px;">🎯 ${s.sport} PARLAY</span>
        <span style="background: ${s.confidence_score >= 0.6 ? '#00ff88' : s.confidence_score >= 0.4 ? '#ffcc00' : '#ff6b6b'}; color: #000; padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: bold;">
          ${s.confidence_score >= 0.6 ? 'HIGH' : s.confidence_score >= 0.4 ? 'MEDIUM' : 'RISKY'} (${(s.confidence_score * 100).toFixed(0)}%)
        </span>
      </div>
      
      ${s.legs.map(leg => `
        <div style="background: rgba(255,255,255,0.05); border-radius: 8px; padding: 12px; margin-bottom: 8px;">
          <div style="color: #fff; font-size: 14px;">${leg.description}</div>
          <div style="color: #888; font-size: 12px; margin-top: 4px;">${leg.sport} • ${leg.betType}</div>
          <div style="color: #00d9ff; font-weight: bold; font-size: 14px; margin-top: 4px;">${formatOdds(leg.odds)}</div>
        </div>
      `).join('')}
      
      <div style="display: flex; justify-content: space-between; margin-top: 16px; padding-top: 16px; border-top: 1px solid rgba(255,255,255,0.1);">
        <div style="text-align: center;">
          <div style="color: #888; font-size: 11px;">TOTAL ODDS</div>
          <div style="color: #00d9ff; font-weight: bold; font-size: 18px;">${formatOdds(s.total_odds)}</div>
        </div>
        <div style="text-align: center;">
          <div style="color: #888; font-size: 11px;">WIN PROB</div>
          <div style="color: #fff; font-weight: bold; font-size: 18px;">${(s.combined_probability * 100).toFixed(1)}%</div>
        </div>
        <div style="text-align: center;">
          <div style="color: #888; font-size: 11px;">$10 WINS</div>
          <div style="color: #00ff88; font-weight: bold; font-size: 18px;">$${s.total_odds > 0 
            ? ((s.total_odds / 100) * 10 + 10).toFixed(0)
            : ((100 / Math.abs(s.total_odds)) * 10 + 10).toFixed(0)
          }</div>
        </div>
      </div>
      
      <div style="background: rgba(0,217,255,0.1); border-radius: 8px; padding: 12px; margin-top: 12px; border: 1px solid rgba(0,217,255,0.2);">
        <div style="color: #00d9ff; font-size: 12px;">💡 ${s.suggestion_reason}</div>
      </div>
    </div>
  `).join('');

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="margin: 0; padding: 0; background-color: #0a0a0f; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
      <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
        <!-- Header -->
        <div style="text-align: center; padding: 30px 0;">
          <div style="font-size: 32px; margin-bottom: 8px;">🔥</div>
          <h1 style="color: #fff; margin: 0; font-size: 24px;">New Parlay Picks</h1>
          <p style="color: #888; margin: 8px 0 0 0; font-size: 14px;">AI-powered suggestions just for you</p>
        </div>
        
        <!-- Greeting -->
        <div style="color: #fff; font-size: 16px; margin-bottom: 20px;">
          ${greeting}! 👋
          <br><br>
          We found <strong style="color: #00d9ff;">${suggestions.length} high-confidence parlay${suggestions.length > 1 ? 's' : ''}</strong> that match your betting patterns. Check them out:
        </div>
        
        <!-- Parlay Cards -->
        ${parlayCards}
        
        <!-- CTA -->
        <div style="text-align: center; margin: 30px 0;">
          <a href="${Deno.env.get('SITE_URL') || 'https://parlay-simulator.lovable.app'}/suggestions" 
             style="display: inline-block; background: linear-gradient(135deg, #ff6b35 0%, #f7931e 100%); color: #fff; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: bold; font-size: 16px;">
            View All Suggestions →
          </a>
        </div>
        
        <!-- Footer -->
        <div style="text-align: center; padding: 20px 0; border-top: 1px solid rgba(255,255,255,0.1); margin-top: 30px;">
          <p style="color: #666; font-size: 12px; margin: 0;">
            You're receiving this because you enabled parlay alerts.
            <br>
            <a href="${Deno.env.get('SITE_URL') || 'https://parlay-simulator.lovable.app'}/profile" style="color: #00d9ff;">Manage preferences</a>
          </p>
          <p style="color: #444; font-size: 11px; margin: 16px 0 0 0;">
            🎰 Parlay Simulator • Bet Responsibly
          </p>
        </div>
      </div>
    </body>
    </html>
  `;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { userId, suggestions } = await req.json();

    // If specific user provided, send to that user
    if (userId && suggestions) {
      const { data: prefs, error: prefsError } = await supabase
        .from('notification_preferences')
        .select('*')
        .eq('user_id', userId)
        .single();

      if (prefsError || !prefs?.email_notifications) {
        console.log('User has notifications disabled or no preferences');
        return new Response(JSON.stringify({ success: false, reason: 'Notifications disabled' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Filter suggestions by user's confidence threshold
      const filteredSuggestions = suggestions.filter(
        (s: any) => s.confidence_score >= prefs.min_confidence_threshold
      );

      if (filteredSuggestions.length === 0) {
        return new Response(JSON.stringify({ success: false, reason: 'No suggestions meet threshold' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Get username
      const { data: profile } = await supabase
        .from('profiles')
        .select('username')
        .eq('user_id', userId)
        .single();

      const emailHtml = generateEmailHtml({
        email: prefs.email,
        username: profile?.username,
        suggestions: filteredSuggestions,
      });

      const emailResponse = await sendEmail(
        prefs.email,
        `🔥 ${filteredSuggestions.length} New High-Confidence Parlay${filteredSuggestions.length > 1 ? 's' : ''} Found!`,
        emailHtml
      );

      console.log("Email sent successfully:", emailResponse);

      // Update last notified timestamp
      await supabase
        .from('notification_preferences')
        .update({ last_notified_at: new Date().toISOString() })
        .eq('user_id', userId);

      return new Response(JSON.stringify({ success: true, emailResponse }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Batch mode: send to all users with notifications enabled
    const { data: allPrefs, error: allPrefsError } = await supabase
      .from('notification_preferences')
      .select('*')
      .eq('email_notifications', true);

    if (allPrefsError) throw allPrefsError;

    const results = [];
    
    for (const prefs of allPrefs || []) {
      // Get user's suggestions
      const { data: userSuggestions } = await supabase
        .from('suggested_parlays')
        .select('*')
        .eq('user_id', prefs.user_id)
        .eq('is_active', true)
        .gte('confidence_score', prefs.min_confidence_threshold)
        .gte('expires_at', new Date().toISOString());

      if (!userSuggestions || userSuggestions.length === 0) continue;

      // Skip if notified recently (within last 6 hours)
      if (prefs.last_notified_at) {
        const lastNotified = new Date(prefs.last_notified_at);
        const hoursSince = (Date.now() - lastNotified.getTime()) / (1000 * 60 * 60);
        if (hoursSince < 6) continue;
      }

      // Get username
      const { data: profile } = await supabase
        .from('profiles')
        .select('username')
        .eq('user_id', prefs.user_id)
        .single();

      const emailHtml = generateEmailHtml({
        email: prefs.email,
        username: profile?.username,
        suggestions: userSuggestions.map(s => ({
          ...s,
          legs: s.legs as SuggestedLeg[],
        })),
      });

      try {
        const emailResponse = await sendEmail(
          prefs.email,
          `🔥 ${userSuggestions.length} New High-Confidence Parlay${userSuggestions.length > 1 ? 's' : ''} Found!`,
          emailHtml
        );

        await supabase
          .from('notification_preferences')
          .update({ last_notified_at: new Date().toISOString() })
          .eq('user_id', prefs.user_id);

        results.push({ userId: prefs.user_id, success: true });
      } catch (emailError) {
        console.error(`Failed to send to ${prefs.email}:`, emailError);
        results.push({ userId: prefs.user_id, success: false, error: emailError });
      }
    }

    return new Response(JSON.stringify({ success: true, results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error("Error in send-parlay-alert function:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
