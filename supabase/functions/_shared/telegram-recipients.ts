// Resolves the list of Telegram chat_ids that should receive a broadcast
// for a given minimum tier. Backed by bot_authorized_users.tier.
// All paid alerts (signals, sweet-spots, FanDuel boosts, Gold parlays)
// fan out to every active "all_access" recipient.

import { Tier, normalizeTier, tierAtLeast } from "./tier-policy.ts";

export interface TelegramRecipient {
  chat_id: string;
  tier: Tier;
  email: string | null;
}

/** Read all active authorized users at or above the requested tier. */
export async function getRecipientsForTier(
  supabase: any,
  minTier: Tier = "all_access",
): Promise<TelegramRecipient[]> {
  const { data, error } = await supabase
    .from("bot_authorized_users")
    .select("chat_id, tier, email, is_active")
    .eq("is_active", true);

  if (error) {
    console.warn("[telegram-recipients] query failed", error);
    return [];
  }

  const out: TelegramRecipient[] = [];
  for (const row of data ?? []) {
    // Legacy authorized bot users were created before tier backfill; treat
    // active blank-tier rows as paid recipients so existing Telegram users
    // keep receiving broadcast alerts.
    const tier = normalizeTier(row.tier) ?? "all_access";
    if (!tier) continue;
    if (!tierAtLeast(tier, minTier)) continue;
    if (!row.chat_id) continue;
    out.push({ chat_id: String(row.chat_id), tier, email: row.email ?? null });
  }
  return out;
}

/**
 * Fan out a Telegram message to every recipient. Returns per-recipient delivery
 * results. Caller passes a sender callback so this helper stays transport-agnostic
 * (works for both raw bot API and the gateway).
 */
export async function broadcastToRecipients(
  recipients: TelegramRecipient[],
  send: (chat_id: string) => Promise<{ ok: boolean; error?: string; message_id?: number }>,
): Promise<{ delivered: number; failed: number; results: Array<{ chat_id: string; ok: boolean; error?: string }> }> {
  const results: Array<{ chat_id: string; ok: boolean; error?: string }> = [];
  let delivered = 0;
  let failed = 0;

  for (const r of recipients) {
    try {
      const res = await send(r.chat_id);
      if (res.ok) {
        delivered++;
        results.push({ chat_id: r.chat_id, ok: true });
      } else {
        failed++;
        results.push({ chat_id: r.chat_id, ok: false, error: res.error });
      }
    } catch (e) {
      failed++;
      results.push({ chat_id: r.chat_id, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }

  return { delivered, failed, results };
}