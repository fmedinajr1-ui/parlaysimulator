import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface PushPayload {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  tag?: string;
  data?: Record<string, any>;
}

interface SharpAlert {
  sport: string;
  description: string;
  bookmaker: string;
  price_change: number;
  sharp_indicator: string;
}

// Web Push implementation using web-push library concepts
async function sendWebPush(
  subscription: { endpoint: string; p256dh_key: string; auth_key: string },
  payload: PushPayload,
  vapidPublicKey: string,
  vapidPrivateKey: string
): Promise<boolean> {
  try {
    // Create the JWT for VAPID
    const header = { typ: "JWT", alg: "ES256" };
    const audience = new URL(subscription.endpoint).origin;
    const exp = Math.floor(Date.now() / 1000) + 60 * 60 * 12; // 12 hours
    
    const jwtPayload = {
      aud: audience,
      exp: exp,
      sub: "mailto:alerts@parlayiq.app"
    };

    // For simplicity, we'll use a direct fetch approach
    // In production, you'd want to use a proper web-push library
    const response = await fetch(subscription.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'TTL': '86400',
      },
      body: JSON.stringify(payload),
    });

    console.log(`Push notification sent to ${subscription.endpoint}, status: ${response.status}`);
    return response.ok || response.status === 201;
  } catch (error) {
    console.error('Error sending push notification:', error);
    return false;
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const vapidPublicKey = Deno.env.get('VAPID_PUBLIC_KEY')!;
    const vapidPrivateKey = Deno.env.get('VAPID_PRIVATE_KEY')!;
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { action, alert, subscription } = await req.json();

    // Handle subscription management
    if (action === 'subscribe') {
      const { endpoint, keys, userId, sportsFilter, sharpOnly } = subscription;
      
      const { data, error } = await supabase
        .from('push_subscriptions')
        .upsert({
          user_id: userId || null,
          endpoint: endpoint,
          p256dh_key: keys.p256dh,
          auth_key: keys.auth,
          is_active: true,
          sports_filter: sportsFilter || [],
          sharp_only: sharpOnly !== false,
        }, {
          onConflict: 'endpoint',
        })
        .select()
        .single();

      if (error) {
        console.error('Error saving subscription:', error);
        throw error;
      }

      console.log('Push subscription saved:', data.id);
      return new Response(JSON.stringify({ success: true, subscriptionId: data.id }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'unsubscribe') {
      const { endpoint } = subscription;
      
      const { error } = await supabase
        .from('push_subscriptions')
        .update({ is_active: false })
        .eq('endpoint', endpoint);

      if (error) throw error;

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Handle sending notifications for sharp alerts
    if (action === 'notify' && alert) {
      const sharpAlert = alert as SharpAlert;
      
      // Get all active subscriptions
      let query = supabase
        .from('push_subscriptions')
        .select('*')
        .eq('is_active', true);

      const { data: subscriptions, error: subError } = await query;

      if (subError) throw subError;

      console.log(`Found ${subscriptions?.length || 0} active subscriptions`);

      const payload: PushPayload = {
        title: `🔥 Sharp Money Alert - ${sharpAlert.sport}`,
        body: `${sharpAlert.description} | ${sharpAlert.sharp_indicator}`,
        icon: '/favicon.ico',
        badge: '/favicon.ico',
        tag: `sharp-${Date.now()}`,
        data: {
          url: '/odds',
          sport: sharpAlert.sport,
          bookmaker: sharpAlert.bookmaker,
          priceChange: sharpAlert.price_change,
        },
      };

      let sentCount = 0;
      let failedCount = 0;

      for (const sub of subscriptions || []) {
        // Filter by sport if user has preferences
        if (sub.sports_filter && sub.sports_filter.length > 0) {
          if (!sub.sports_filter.includes(sharpAlert.sport) && !sub.sports_filter.includes('all')) {
            continue;
          }
        }

        const success = await sendWebPush(
          { endpoint: sub.endpoint, p256dh_key: sub.p256dh_key, auth_key: sub.auth_key },
          payload,
          vapidPublicKey,
          vapidPrivateKey
        );

        if (success) {
          sentCount++;
        } else {
          failedCount++;
          // Mark failed subscriptions as inactive
          await supabase
            .from('push_subscriptions')
            .update({ is_active: false })
            .eq('id', sub.id);
        }
      }

      console.log(`Notifications sent: ${sentCount}, failed: ${failedCount}`);

      return new Response(JSON.stringify({ 
        success: true, 
        sent: sentCount, 
        failed: failedCount 
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Handle morning juice scan notifications
    if (action === 'notify_morning_juice') {
      const { data: juiceData } = req.json ? await req.json().catch(() => ({})) : {};
      const notifyData = juiceData || (await req.json().catch(() => ({}))).data;
      
      const { data: subscriptions, error: subError } = await supabase
        .from('push_subscriptions')
        .select('*')
        .eq('is_active', true);

      if (subError) throw subError;

      const payload: PushPayload = {
        title: `🌅 Morning Juiced Overs`,
        body: `${notifyData?.total || 0} player props with heavy Over action found for today`,
        icon: '/favicon.ico',
        badge: '/favicon.ico',
        tag: `morning-juice-${Date.now()}`,
        data: {
          url: '/suggestions',
          type: 'morning_juice_scan',
          total: notifyData?.total || 0,
          heavy: notifyData?.heavy || 0,
        },
      };

      let sentCount = 0;
      for (const sub of subscriptions || []) {
        const success = await sendWebPush(
          { endpoint: sub.endpoint, p256dh_key: sub.p256dh_key, auth_key: sub.auth_key },
          payload,
          vapidPublicKey,
          vapidPrivateKey
        );
        if (success) sentCount++;
      }

      return new Response(JSON.stringify({ success: true, sent: sentCount }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Handle final pick locked notifications
    if (action === 'notify_final_pick') {
      const { data: pickData } = req.json ? await req.json().catch(() => ({})) : {};
      const notifyData = pickData || (await req.json().catch(() => ({}))).data;
      
      const { data: subscriptions, error: subError } = await supabase
        .from('push_subscriptions')
        .select('*')
        .eq('is_active', true);

      if (subError) throw subError;

      const oddsDisplay = notifyData?.odds > 0 ? `+${notifyData.odds}` : notifyData?.odds;
      
      const payload: PushPayload = {
        title: `🎯 FINAL PICK LOCKED`,
        body: `${notifyData?.player} ${notifyData?.pick} ${notifyData?.line} ${notifyData?.prop} @ ${oddsDisplay}`,
        icon: '/favicon.ico',
        badge: '/favicon.ico',
        tag: `final-pick-${Date.now()}`,
        data: {
          url: '/suggestions',
          type: 'final_pick',
          player: notifyData?.player,
          prop: notifyData?.prop,
          pick: notifyData?.pick,
          line: notifyData?.line,
          odds: notifyData?.odds,
          confidence: notifyData?.confidence,
          reason: notifyData?.reason,
        },
      };

      let sentCount = 0;
      for (const sub of subscriptions || []) {
        const success = await sendWebPush(
          { endpoint: sub.endpoint, p256dh_key: sub.p256dh_key, auth_key: sub.auth_key },
          payload,
          vapidPublicKey,
          vapidPrivateKey
        );
        if (success) sentCount++;
      }

      return new Response(JSON.stringify({ success: true, sent: sentCount }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get VAPID public key for client
    if (action === 'getVapidKey') {
      return new Response(JSON.stringify({ 
        vapidPublicKey: vapidPublicKey 
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Invalid action' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('Error in send-push-notification:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
