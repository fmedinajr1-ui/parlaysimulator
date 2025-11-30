import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface OddsOutcome {
  name: string;
  price: number;
}

interface OddsMarket {
  key: string;
  outcomes: OddsOutcome[];
}

interface OddsBookmaker {
  key: string;
  title: string;
  markets: OddsMarket[];
}

interface OddsEvent {
  id: string;
  sport_key: string;
  sport_title: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers: OddsBookmaker[];
}

const SPORT_KEYS: Record<string, string> = {
  'NBA': 'basketball_nba',
  'NFL': 'americanfootball_nfl',
  'MLB': 'baseball_mlb',
  'NHL': 'icehockey_nhl',
  'NCAAB': 'basketball_ncaab',
  'NCAAF': 'americanfootball_ncaaf',
  'Soccer': 'soccer_epl',
};

function decimalToAmerican(decimal: number): number {
  if (decimal >= 2) {
    return Math.round((decimal - 1) * 100);
  } else {
    return Math.round(-100 / (decimal - 1));
  }
}

function americanToImplied(odds: number): number {
  if (odds > 0) {
    return 100 / (odds + 100);
  } else {
    return Math.abs(odds) / (Math.abs(odds) + 100);
  }
}

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");

async function sendEmail(to: string, subject: string, html: string) {
  if (!RESEND_API_KEY) {
    console.log('RESEND_API_KEY not configured, skipping email');
    return null;
  }
  
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
    console.error(`Resend error: ${error}`);
    return null;
  }
  
  return response.json();
}

function formatOdds(odds: number): string {
  return odds > 0 ? `+${odds}` : odds.toString();
}

function generateEmailHtml(username: string | null, suggestions: any[]): string {
  const greeting = username ? `Hey ${username}` : "Hey";
  
  const parlayCards = suggestions.slice(0, 3).map((s) => `
    <div style="background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); border-radius: 12px; padding: 20px; margin-bottom: 16px; border: 1px solid #0f3460;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
        <span style="color: #00d9ff; font-weight: bold; font-size: 14px;">🎯 ${s.sport} PARLAY</span>
        <span style="background: ${s.confidence_score >= 0.6 ? '#00ff88' : s.confidence_score >= 0.4 ? '#ffcc00' : '#ff6b6b'}; color: #000; padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: bold;">
          ${(s.confidence_score * 100).toFixed(0)}%
        </span>
      </div>
      
      ${s.legs.slice(0, 3).map((leg: any) => `
        <div style="background: rgba(255,255,255,0.05); border-radius: 8px; padding: 12px; margin-bottom: 8px;">
          <div style="color: #fff; font-size: 14px;">${leg.description}</div>
          <div style="color: #00d9ff; font-weight: bold; font-size: 14px; margin-top: 4px;">${formatOdds(leg.odds)}</div>
        </div>
      `).join('')}
      
      <div style="display: flex; justify-content: space-between; margin-top: 16px; padding-top: 16px; border-top: 1px solid rgba(255,255,255,0.1);">
        <div style="text-align: center;">
          <div style="color: #888; font-size: 11px;">ODDS</div>
          <div style="color: #00d9ff; font-weight: bold; font-size: 16px;">${formatOdds(s.total_odds)}</div>
        </div>
        <div style="text-align: center;">
          <div style="color: #888; font-size: 11px;">WIN PROB</div>
          <div style="color: #fff; font-weight: bold; font-size: 16px;">${(s.combined_probability * 100).toFixed(1)}%</div>
        </div>
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
        <div style="text-align: center; padding: 30px 0;">
          <div style="font-size: 32px; margin-bottom: 8px;">🔥</div>
          <h1 style="color: #fff; margin: 0; font-size: 24px;">Daily Parlay Picks</h1>
        </div>
        
        <div style="color: #fff; font-size: 16px; margin-bottom: 20px;">
          ${greeting}! 👋<br><br>
          Here are today's <strong style="color: #00d9ff;">${suggestions.length} AI-picked parlays</strong>:
        </div>
        
        ${parlayCards}
        
        <div style="text-align: center; margin: 30px 0;">
          <a href="${Deno.env.get('SITE_URL') || 'https://parlay-simulator.lovable.app'}/suggestions" 
             style="display: inline-block; background: linear-gradient(135deg, #ff6b35 0%, #f7931e 100%); color: #fff; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: bold; font-size: 16px;">
            View All Picks →
          </a>
        </div>
        
        <div style="text-align: center; padding: 20px 0; border-top: 1px solid rgba(255,255,255,0.1); margin-top: 30px;">
          <p style="color: #666; font-size: 12px; margin: 0;">
            <a href="${Deno.env.get('SITE_URL') || 'https://parlay-simulator.lovable.app'}/profile" style="color: #00d9ff;">Manage preferences</a>
          </p>
        </div>
      </div>
    </body>
    </html>
  `;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  console.log('🚀 Daily suggestions job started at:', new Date().toISOString());

  try {
    const ODDS_API_KEY = Deno.env.get('THE_ODDS_API_KEY');
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    if (!ODDS_API_KEY) {
      throw new Error('THE_ODDS_API_KEY is not configured');
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Step 1: Get all Pro users (subscribed or admin)
    const { data: subscriptions } = await supabase
      .from('subscriptions')
      .select('user_id')
      .eq('status', 'active');

    const { data: adminRoles } = await supabase
      .from('user_roles')
      .select('user_id')
      .eq('role', 'admin');

    const proUserIds = new Set<string>();
    subscriptions?.forEach(s => proUserIds.add(s.user_id));
    adminRoles?.forEach(r => proUserIds.add(r.user_id));

    console.log(`Found ${proUserIds.size} Pro users`);

    if (proUserIds.size === 0) {
      return new Response(JSON.stringify({ 
        success: true, 
        message: 'No Pro users to process',
        duration: Date.now() - startTime 
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Step 2: Fetch odds for popular sports
    const sportsToFetch = ['NBA', 'NFL', 'NHL', 'MLB'];
    const allOdds: OddsEvent[] = [];

    for (const sport of sportsToFetch) {
      const sportKey = SPORT_KEYS[sport];
      try {
        const oddsUrl = `https://api.the-odds-api.com/v4/sports/${sportKey}/odds/?apiKey=${ODDS_API_KEY}&regions=us&markets=h2h&oddsFormat=decimal`;
        const oddsResponse = await fetch(oddsUrl);
        
        if (oddsResponse.ok) {
          const events: OddsEvent[] = await oddsResponse.json();
          for (const event of events.slice(0, 5)) {
            event.sport_key = sport;
          }
          allOdds.push(...events.slice(0, 5));
        }
      } catch (error) {
        console.error(`Error fetching ${sport} odds:`, error);
      }
    }

    console.log(`Fetched ${allOdds.length} events`);

    if (allOdds.length < 2) {
      return new Response(JSON.stringify({ 
        success: true, 
        message: 'Not enough games available',
        duration: Date.now() - startTime 
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Step 3: Generate suggestions for each user
    const results = {
      usersProcessed: 0,
      suggestionsGenerated: 0,
      emailsSent: 0,
      errors: [] as string[],
    };

    for (const userId of proUserIds) {
      try {
        // Get user's betting history for personalization
        const { data: userHistory } = await supabase
          .from('parlay_training_data')
          .select('sport, bet_type, odds, parlay_outcome')
          .eq('user_id', userId)
          .limit(50);

        // Determine favorite sports
        const sportCounts: Record<string, number> = {};
        userHistory?.forEach(leg => {
          if (leg.sport) {
            sportCounts[leg.sport] = (sportCounts[leg.sport] || 0) + 1;
          }
        });
        
        const favoriteSports = Object.entries(sportCounts)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 2)
          .map(([sport]) => sport);

        // Filter events by user preferences
        const relevantEvents = favoriteSports.length > 0
          ? allOdds.filter(e => favoriteSports.includes(e.sport_key))
          : allOdds;

        const eventsToUse = relevantEvents.length >= 2 ? relevantEvents : allOdds;

        // Generate parlay suggestions
        const suggestions = [];

        // Strategy 1: Favorites parlay
        if (eventsToUse.length >= 2) {
          const legs = [];
          let totalProb = 1;

          for (const event of eventsToUse.slice(0, 3)) {
            const bookmaker = event.bookmakers[0];
            if (!bookmaker) continue;

            const h2hMarket = bookmaker.markets.find(m => m.key === 'h2h');
            if (!h2hMarket) continue;

            const favorite = h2hMarket.outcomes.reduce((a, b) => 
              a.price < b.price ? a : b
            );
            
            const americanOdds = decimalToAmerican(favorite.price);
            const impliedProb = americanToImplied(americanOdds);
            totalProb *= impliedProb;

            legs.push({
              description: `${favorite.name} ML vs ${event.home_team === favorite.name ? event.away_team : event.home_team}`,
              odds: americanOdds,
              impliedProbability: impliedProb,
              sport: event.sport_key,
              betType: 'moneyline',
              eventTime: event.commence_time,
            });
          }

          if (legs.length >= 2) {
            const totalOdds = legs.reduce((acc, leg) => {
              const decimal = leg.odds > 0 ? (leg.odds / 100) + 1 : (100 / Math.abs(leg.odds)) + 1;
              return acc * decimal;
            }, 1);

            suggestions.push({
              legs,
              total_odds: decimalToAmerican(totalOdds),
              combined_probability: totalProb,
              suggestion_reason: `Daily favorites parlay based on ${favoriteSports.length > 0 ? 'your betting history' : 'today\'s best matchups'}.`,
              sport: favoriteSports[0] || 'Mixed',
              confidence_score: Math.min(totalProb * 1.2, 0.85),
              expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
            });
          }
        }

        // Strategy 2: Value underdog
        const underdogLegs = [];
        let underdogProb = 1;

        for (const event of eventsToUse.slice(0, 4)) {
          const bookmaker = event.bookmakers[0];
          if (!bookmaker) continue;

          const h2hMarket = bookmaker.markets.find(m => m.key === 'h2h');
          if (!h2hMarket) continue;

          const underdog = h2hMarket.outcomes.reduce((a, b) => 
            a.price > b.price ? a : b
          );
          
          const americanOdds = decimalToAmerican(underdog.price);
          
          if (americanOdds >= 100 && americanOdds <= 220) {
            const impliedProb = americanToImplied(americanOdds);
            underdogProb *= impliedProb;

            underdogLegs.push({
              description: `${underdog.name} ML vs ${event.home_team === underdog.name ? event.away_team : event.home_team}`,
              odds: americanOdds,
              impliedProbability: impliedProb,
              sport: event.sport_key,
              betType: 'moneyline',
              eventTime: event.commence_time,
            });

            if (underdogLegs.length >= 2) break;
          }
        }

        if (underdogLegs.length >= 2) {
          const totalOdds = underdogLegs.reduce((acc, leg) => {
            const decimal = leg.odds > 0 ? (leg.odds / 100) + 1 : (100 / Math.abs(leg.odds)) + 1;
            return acc * decimal;
          }, 1);

          suggestions.push({
            legs: underdogLegs,
            total_odds: decimalToAmerican(totalOdds),
            combined_probability: underdogProb,
            suggestion_reason: 'Value play with slight underdogs. Higher risk, higher reward!',
            sport: 'Mixed',
            confidence_score: 0.45,
            expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          });
        }

        // Save suggestions
        if (suggestions.length > 0) {
          // Clear old suggestions
          await supabase
            .from('suggested_parlays')
            .delete()
            .eq('user_id', userId);

          // Insert new ones
          await supabase
            .from('suggested_parlays')
            .insert(suggestions.map(s => ({
              user_id: userId,
              ...s,
            })));

          results.suggestionsGenerated += suggestions.length;
        }

        results.usersProcessed++;

        // Step 4: Send email notification if enabled
        const { data: prefs } = await supabase
          .from('notification_preferences')
          .select('*')
          .eq('user_id', userId)
          .eq('email_notifications', true)
          .single();

        if (prefs && suggestions.length > 0) {
          // Check if notified in last 20 hours (to allow daily emails)
          const shouldNotify = !prefs.last_notified_at || 
            (Date.now() - new Date(prefs.last_notified_at).getTime()) > 20 * 60 * 60 * 1000;

          if (shouldNotify) {
            // Filter by confidence threshold
            const qualifiedSuggestions = suggestions.filter(
              s => s.confidence_score >= prefs.min_confidence_threshold
            );

            if (qualifiedSuggestions.length > 0) {
              // Get username
              const { data: profile } = await supabase
                .from('profiles')
                .select('username')
                .eq('user_id', userId)
                .single();

              const emailHtml = generateEmailHtml(profile?.username, qualifiedSuggestions);
              
              const emailResult = await sendEmail(
                prefs.email,
                `🔥 ${qualifiedSuggestions.length} Daily Parlay Pick${qualifiedSuggestions.length > 1 ? 's' : ''} Ready!`,
                emailHtml
              );

              if (emailResult) {
                await supabase
                  .from('notification_preferences')
                  .update({ last_notified_at: new Date().toISOString() })
                  .eq('user_id', userId);

                results.emailsSent++;
              }
            }
          }
        }

      } catch (error) {
        console.error(`Error processing user ${userId}:`, error);
        results.errors.push(`User ${userId}: ${error}`);
      }
    }

    const duration = Date.now() - startTime;
    console.log(`✅ Job completed in ${duration}ms:`, results);

    return new Response(JSON.stringify({ 
      success: true, 
      results,
      duration,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('❌ Daily suggestions job failed:', error);
    return new Response(JSON.stringify({ 
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      duration: Date.now() - startTime,
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
