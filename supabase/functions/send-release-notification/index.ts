import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { Resend } from "https://esm.sh/resend@2.0.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface Release {
  id: string;
  version: string;
  title: string;
  summary: string;
  body: string | null;
  release_type: string;
}

interface PushPayload {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  tag?: string;
  data?: Record<string, any>;
}

async function sendWebPush(
  subscription: { endpoint: string; p256dh_key: string; auth_key: string },
  payload: PushPayload
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
    console.log(`Push sent to ${subscription.endpoint}, status: ${response.status}`);
    return response.ok || response.status === 201;
  } catch (error) {
    console.error('Error sending push:', error);
    return false;
  }
}

function generateReleaseEmailHtml(release: Release): string {
  const releaseTypeEmoji = {
    major: '🚀',
    feature: '✨',
    improvement: '🔧',
    bugfix: '🐛',
  }[release.release_type] || '📦';

  const releaseTypeBadge = {
    major: 'background: linear-gradient(135deg, #f97316, #ea580c);',
    feature: 'background: linear-gradient(135deg, #22c55e, #16a34a);',
    improvement: 'background: linear-gradient(135deg, #3b82f6, #2563eb);',
    bugfix: 'background: linear-gradient(135deg, #a855f7, #9333ea);',
  }[release.release_type] || 'background: #6b7280;';

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; background-color: #0a0a0b; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #0a0a0b; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="100%" max-width="600" cellpadding="0" cellspacing="0" style="max-width: 600px; background: linear-gradient(180deg, #18181b 0%, #0f0f10 100%); border-radius: 16px; border: 1px solid #27272a; overflow: hidden;">
          <!-- Header -->
          <tr>
            <td style="padding: 32px 32px 24px; text-align: center; border-bottom: 1px solid #27272a;">
              <div style="display: inline-block; ${releaseTypeBadge} padding: 6px 16px; border-radius: 20px; margin-bottom: 16px;">
                <span style="color: white; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">
                  ${releaseTypeEmoji} ${release.release_type}
                </span>
              </div>
              <h1 style="margin: 0; color: #fafafa; font-size: 28px; font-weight: 700; line-height: 1.3;">
                ${release.title}
              </h1>
              <p style="margin: 8px 0 0; color: #71717a; font-size: 14px;">
                Version ${release.version}
              </p>
            </td>
          </tr>
          
          <!-- Summary -->
          <tr>
            <td style="padding: 24px 32px;">
              <p style="margin: 0; color: #a1a1aa; font-size: 16px; line-height: 1.6;">
                ${release.summary}
              </p>
            </td>
          </tr>
          
          <!-- Body Content -->
          ${release.body ? `
          <tr>
            <td style="padding: 0 32px 24px;">
              <div style="background: #1f1f23; border-radius: 12px; padding: 20px; border: 1px solid #27272a;">
                <h3 style="margin: 0 0 12px; color: #fafafa; font-size: 14px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">
                  What's New
                </h3>
                <div style="color: #d4d4d8; font-size: 14px; line-height: 1.7;">
                  ${release.body.split('\n').map(line => `<p style="margin: 0 0 8px;">${line}</p>`).join('')}
                </div>
              </div>
            </td>
          </tr>
          ` : ''}
          
          <!-- CTA Button -->
          <tr>
            <td style="padding: 0 32px 32px; text-align: center;">
              <a href="https://parlayfarm.app/changelog" style="display: inline-block; background: linear-gradient(135deg, #22c55e, #16a34a); color: white; text-decoration: none; padding: 14px 32px; border-radius: 10px; font-weight: 600; font-size: 16px;">
                See Full Details →
              </a>
            </td>
          </tr>
          
          <!-- Footer -->
          <tr>
            <td style="padding: 24px 32px; background: #0f0f10; border-top: 1px solid #27272a; text-align: center;">
              <p style="margin: 0 0 8px; color: #71717a; font-size: 12px;">
                You're receiving this because you opted into release notifications.
              </p>
              <a href="https://parlayfarm.app/profile" style="color: #22c55e; font-size: 12px; text-decoration: none;">
                Manage notification preferences
              </a>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const resendApiKey = Deno.env.get('RESEND_API_KEY');

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const { action, release_id } = await req.json();

    if (action === 'send_release') {
      if (!release_id) {
        throw new Error('release_id is required');
      }

      // Fetch the release
      const { data: release, error: releaseError } = await supabase
        .from('app_releases')
        .select('*')
        .eq('id', release_id)
        .single();

      if (releaseError || !release) {
        throw new Error('Release not found');
      }

      if (release.notifications_sent) {
        return new Response(JSON.stringify({ 
          success: false, 
          message: 'Notifications already sent for this release' 
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const stats = { pushSent: 0, pushFailed: 0, emailSent: 0, emailFailed: 0 };

      // 1. Send push notifications to all active subscriptions with push_release_notifications enabled
      const { data: pushSubs } = await supabase
        .from('push_subscriptions')
        .select('*')
        .eq('is_active', true);

      // Get users who have push_release_notifications disabled
      const { data: disabledPushUsers } = await supabase
        .from('notification_preferences')
        .select('user_id')
        .eq('push_release_notifications', false);

      const disabledPushUserIds = new Set((disabledPushUsers || []).map(u => u.user_id));

      const pushPayload: PushPayload = {
        title: `🆕 Parlay Farm ${release.version}`,
        body: release.summary,
        icon: '/pwa-192x192.png',
        badge: '/pwa-192x192.png',
        tag: `release-${release.version}`,
        data: { url: '/changelog' },
      };

      for (const sub of pushSubs || []) {
        // Skip if user has disabled push release notifications
        if (sub.user_id && disabledPushUserIds.has(sub.user_id)) {
          console.log(`Skipping push for user ${sub.user_id} - disabled`);
          continue;
        }

        const success = await sendWebPush(sub, pushPayload);
        if (success) {
          stats.pushSent++;
        } else {
          stats.pushFailed++;
          // Mark failed subscription as inactive
          await supabase
            .from('push_subscriptions')
            .update({ is_active: false })
            .eq('id', sub.id);
        }
      }

      // 2. Send emails to users with release_notifications enabled
      if (resendApiKey) {
        const resend = new Resend(resendApiKey);

        const { data: emailPrefs } = await supabase
          .from('notification_preferences')
          .select('email, user_id')
          .eq('release_notifications', true)
          .eq('email_notifications', true);

        const emailHtml = generateReleaseEmailHtml(release);

        for (const pref of emailPrefs || []) {
          if (!pref.email) continue;

          try {
            await resend.emails.send({
              from: 'Parlay Farm <updates@parlayfarm.app>',
              to: [pref.email],
              subject: `🚀 Parlay Farm ${release.version}: ${release.title}`,
              html: emailHtml,
            });
            stats.emailSent++;
            console.log(`Email sent to ${pref.email}`);
          } catch (emailError) {
            console.error(`Failed to send email to ${pref.email}:`, emailError);
            stats.emailFailed++;
          }
        }
      } else {
        console.log('RESEND_API_KEY not configured, skipping emails');
      }

      // 3. Mark release as notifications_sent
      await supabase
        .from('app_releases')
        .update({ notifications_sent: true })
        .eq('id', release_id);

      console.log('Release notification stats:', stats);

      return new Response(JSON.stringify({ 
        success: true, 
        stats,
        message: `Sent ${stats.pushSent} push and ${stats.emailSent} email notifications`
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Invalid action' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('Error in send-release-notification:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
