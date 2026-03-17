import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Only send push for these significant status transitions
const PUSH_WORTHY_STATUSES = ['HEDGE ALERT', 'HEDGE NOW', 'LOCK'];

interface HedgeAlert {
  playerName: string;
  propType: string;
  line: number;
  side: string;
  hedgeAction: string;
  previousStatus: string | null;
  currentValue: number;
  projectedFinal: number;
  gameProgress: number;
  quarter: number;
}

function getStatusEmoji(status: string): string {
  switch (status) {
    case 'LOCK': return '🔒';
    case 'HOLD': return '🟢';
    case 'MONITOR': return '🟡';
    case 'HEDGE ALERT': return '🟠';
    case 'HEDGE NOW': return '🔴';
    default: return '⚪';
  }
}

function buildNotificationMessage(alert: HedgeAlert): { title: string; body: string } {
  const emoji = getStatusEmoji(alert.hedgeAction);
  const propLabel = alert.propType.replace('player_', '').toUpperCase();
  const sideChar = alert.side.charAt(0).toUpperCase();

  if (alert.hedgeAction === 'LOCK') {
    return {
      title: `${emoji} LOCKED — ${alert.playerName}`,
      body: `${propLabel} ${sideChar}${alert.line} already hit at ${alert.currentValue}! 💰`,
    };
  }

  if (alert.hedgeAction === 'HEDGE NOW') {
    return {
      title: `${emoji} HEDGE NOW — ${alert.playerName}`,
      body: `${propLabel} ${sideChar}${alert.line} — Projected ${alert.projectedFinal.toFixed(1)}, consider hedging immediately`,
    };
  }

  // HEDGE ALERT
  return {
    title: `${emoji} Hedge Alert — ${alert.playerName}`,
    body: `${propLabel} ${sideChar}${alert.line} — Current: ${alert.currentValue}, Projected: ${alert.projectedFinal.toFixed(1)}. Monitor closely.`,
  };
}

async function sendWebPush(
  subscription: { endpoint: string; p256dh_key: string; auth_key: string },
  payload: { title: string; body: string; icon?: string; tag?: string; data?: Record<string, any> },
): Promise<boolean> {
  try {
    const response = await fetch(subscription.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'TTL': '86400',
      },
      body: JSON.stringify(payload),
    });
    return response.ok || response.status === 201;
  } catch (error) {
    console.error('Push send error:', error);
    return false;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { alerts } = await req.json() as { alerts: HedgeAlert[] };

    if (!alerts || alerts.length === 0) {
      return new Response(JSON.stringify({ success: true, sent: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Filter to only push-worthy statuses
    const pushAlerts = alerts.filter(a => PUSH_WORTHY_STATUSES.includes(a.hedgeAction));
    console.log(`[HedgePush] ${alerts.length} alerts received, ${pushAlerts.length} push-worthy`);

    if (pushAlerts.length === 0) {
      return new Response(JSON.stringify({ success: true, sent: 0, reason: 'no push-worthy statuses' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get active push subscriptions where user has hedge alerts enabled
    // Join with notification_preferences to check push_hedge_alerts
    const { data: subscriptions, error: subErr } = await supabase
      .from('push_subscriptions')
      .select('*')
      .eq('is_active', true);

    if (subErr) throw subErr;

    // Get notification preferences for users who have push_hedge_alerts enabled
    const { data: prefs, error: prefsErr } = await supabase
      .from('notification_preferences')
      .select('user_id, push_hedge_alerts')
      .eq('push_hedge_alerts', true);

    if (prefsErr) throw prefsErr;

    const hedgeEnabledUserIds = new Set((prefs || []).map(p => p.user_id));

    // Filter subscriptions: include if user has hedge alerts enabled, or if no prefs exist (default true)
    const eligibleSubs = (subscriptions || []).filter(sub => {
      if (!sub.user_id) return false; // Skip anonymous subscriptions
      return hedgeEnabledUserIds.has(sub.user_id) || 
        !(prefs || []).some(p => p.user_id === sub.user_id); // Default: enabled if no prefs row
    });

    console.log(`[HedgePush] ${eligibleSubs.length} eligible subscriptions`);

    let totalSent = 0;
    let totalFailed = 0;

    // Insert in-app notifications for all users with prefs
    const inAppRows = [];

    for (const alert of pushAlerts) {
      const { title, body } = buildNotificationMessage(alert);
      const statusTransition = alert.previousStatus
        ? `${alert.previousStatus} → ${alert.hedgeAction}`
        : alert.hedgeAction;

      // Send push to each eligible subscription
      for (const sub of eligibleSubs) {
        const success = await sendWebPush(
          { endpoint: sub.endpoint, p256dh_key: sub.p256dh_key, auth_key: sub.auth_key },
          {
            title,
            body,
            icon: '/favicon.ico',
            tag: `hedge-${alert.playerName}-${alert.propType}`,
            data: { url: '/odds', hedgeAction: alert.hedgeAction },
          },
        );

        if (success) {
          totalSent++;
        } else {
          totalFailed++;
          await supabase
            .from('push_subscriptions')
            .update({ is_active: false })
            .eq('id', sub.id);
        }
      }

      // Collect in-app notification rows for all hedge-enabled users
      for (const userId of hedgeEnabledUserIds) {
        inAppRows.push({
          user_id: userId,
          player_name: alert.playerName,
          prop_type: alert.propType,
          line: alert.line,
          side: alert.side,
          hedge_action: alert.hedgeAction,
          status_transition: statusTransition,
          current_value: alert.currentValue,
          projected_final: alert.projectedFinal,
          message: `${title}: ${body}`,
        });
      }
    }

    // Batch insert in-app notifications
    if (inAppRows.length > 0) {
      const { error: insertErr } = await supabase
        .from('customer_hedge_notifications')
        .insert(inAppRows);
      if (insertErr) console.error('[HedgePush] In-app insert error:', insertErr);
      else console.log(`[HedgePush] Inserted ${inAppRows.length} in-app notifications`);
    }

    console.log(`[HedgePush] Push sent: ${totalSent}, failed: ${totalFailed}`);

    return new Response(JSON.stringify({
      success: true,
      pushSent: totalSent,
      pushFailed: totalFailed,
      inAppInserted: inAppRows.length,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('[HedgePush] Error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
