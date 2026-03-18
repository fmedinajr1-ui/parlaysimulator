/**
 * send-slate-advisory
 * 
 * Classifies the daily slate and sends notifications:
 * - Admin: detailed Telegram message with game count, sports, flags, stake guidance
 * - Customers: push + in-app notification with simplified advisory
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface SlateData {
  date: string;
  gameCount: number;
  sports: string[];
  contextFlags: any[];
  thinSlate: boolean;
}

interface SlateClassification {
  level: 'thin' | 'light' | 'heavy';
  emoji: string;
  label: string;
  stakeGuidance: string;
  stakeMultiplier: number;
  maxLegs: number;
}

function classifySlate(gameCount: number): SlateClassification {
  if (gameCount < 6) {
    return {
      level: 'thin',
      emoji: '🔴',
      label: 'Thin Slate',
      stakeGuidance: 'Reduce stakes 50%, max 3 legs',
      stakeMultiplier: 0.5,
      maxLegs: 3,
    };
  }
  if (gameCount <= 8) {
    return {
      level: 'light',
      emoji: '🟡',
      label: 'Light Slate',
      stakeGuidance: 'Reduce stakes 25%',
      stakeMultiplier: 0.75,
      maxLegs: 4,
    };
  }
  return {
    level: 'heavy',
    emoji: '🟢',
    label: 'Heavy Slate',
    stakeGuidance: 'Full volume — go time!',
    stakeMultiplier: 1.0,
    maxLegs: 6,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const slateData: SlateData = await req.json();
    const { date, gameCount, sports, contextFlags } = slateData;
    const classification = classifySlate(gameCount);

    console.log(`[SlateAdvisory] ${classification.emoji} ${classification.label}: ${gameCount} games across ${sports.join(', ')}`);

    // === ADMIN TELEGRAM ===
    const revengeCount = contextFlags.filter((f: any) => f.type === 'revenge_game').length;
    const fatigueCount = contextFlags.filter((f: any) => f.type === 'b2b_fatigue').length;
    const blowoutCount = contextFlags.filter((f: any) => f.type === 'blowout_risk').length;

    const sportsLabel = sports.join(', ');
    const guidanceLines = classification.level === 'thin'
      ? [
          `→ Cut your stakes in half`,
          `→ Keep parlays to ${classification.maxLegs} legs max`,
          `→ Be extra selective with picks`,
        ]
      : classification.level === 'light'
      ? [
          `→ Dial back stakes ~25%`,
          `→ Cap parlays at ${classification.maxLegs} legs`,
          `→ Prioritize quality over volume`,
        ]
      : [
          `→ Full volume — let it fly`,
          `→ Up to ${classification.maxLegs} legs per parlay`,
          `→ Plenty of edges to work with`,
        ];

    const adminMessage = [
      `${classification.emoji} <b>SLATE ADVISORY — ${date}</b>`,
      ``,
      `<b>Classification:</b> ${classification.label}`,
      `<b>Games:</b> ${gameCount} across ${sportsLabel}`,
      `<b>Stake Multiplier:</b> ${classification.stakeMultiplier}x`,
      `<b>Max Legs:</b> ${classification.maxLegs}`,
      `<b>Guidance:</b> ${classification.stakeGuidance}`,
      ``,
      `<b>Context Flags:</b>`,
      `• ${revengeCount} revenge game${revengeCount !== 1 ? 's' : ''}`,
      `• ${fatigueCount} B2B fatigue flag${fatigueCount !== 1 ? 's' : ''}`,
      `• ${blowoutCount} blowout risk game${blowoutCount !== 1 ? 's' : ''}`,
      `• ${revengeCount + fatigueCount + blowoutCount} total flags`,
    ].join('\n');

    try {
      await supabase.functions.invoke('bot-send-telegram', {
        body: { message: adminMessage, parse_mode: 'HTML' },
      });
      console.log('[SlateAdvisory] Admin Telegram sent');
    } catch (err) {
      console.error('[SlateAdvisory] Telegram error:', err);
    }

    // === CUSTOMER NOTIFICATIONS ===
    const customerMessage = classification.level === 'thin'
      ? `🔴 Light day — only ${gameCount} games. Go easy on stakes and keep parlays short.`
      : classification.level === 'light'
      ? `🟡 Moderate slate — ${gameCount} games today across ${sports.join('/')}. Dial back stakes a bit.`
      : `🟢 Loaded slate — ${gameCount} games across ${sports.join('/')}. Full send today!`;

    // Get opted-in customers
    const { data: prefs } = await supabase
      .from('notification_preferences')
      .select('user_id, email')
      .eq('email_notifications', true)
      .eq('push_slate_advisory', true);

    const optedInUsers = prefs || [];
    console.log(`[SlateAdvisory] ${optedInUsers.length} customers opted in for slate advisory`);

    // Insert in-app notifications for all opted-in users
    if (optedInUsers.length > 0) {
      const notifications = optedInUsers.map((p: any) => ({
        user_id: p.user_id,
        alert_type: 'slate_advisory',
        title: `${classification.emoji} ${classification.label}`,
        message: customerMessage,
        metadata: {
          date,
          game_count: gameCount,
          sports,
          classification: classification.level,
          stake_multiplier: classification.stakeMultiplier,
          max_legs: classification.maxLegs,
        },
      }));

      const { error: insertErr } = await supabase
        .from('customer_hedge_notifications')
        .insert(notifications);

      if (insertErr) {
        console.error('[SlateAdvisory] Insert notification error:', insertErr);
      } else {
        console.log(`[SlateAdvisory] ${notifications.length} in-app notifications inserted`);
      }
    }

    // Send push notifications to subscribed users
    const userIds = optedInUsers.map((p: any) => p.user_id);
    if (userIds.length > 0) {
      const { data: pushSubs } = await supabase
        .from('push_subscriptions')
        .select('*')
        .in('user_id', userIds);

      if (pushSubs && pushSubs.length > 0) {
        console.log(`[SlateAdvisory] Sending push to ${pushSubs.length} subscriptions`);
        // Dispatch push via the existing push notification function
        try {
          await supabase.functions.invoke('send-hedge-push-notification', {
            body: {
              type: 'slate_advisory',
              title: `${classification.emoji} ${classification.label}`,
              body: customerMessage,
              userIds,
            },
          });
        } catch (pushErr) {
          console.error('[SlateAdvisory] Push dispatch error:', pushErr);
        }
      }
    }

    return new Response(JSON.stringify({
      success: true,
      classification,
      customerNotifications: optedInUsers.length,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[SlateAdvisory] Error:', error);
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
