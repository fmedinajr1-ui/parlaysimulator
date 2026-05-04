// Tier policy helpers — single source of truth for who can do what.
// Lovable Cloud edge functions import from here so the matrix stays consistent
// across Spike (web), the Telegram bot, and every broadcast channel.

export type Tier = "pup" | "all_access";

export const ALL_ACCESS: Tier = "all_access";
export const PUP: Tier = "pup";

/** Tier rank: higher = more access. */
const RANK: Record<Tier, number> = { pup: 0, all_access: 1 };

export function tierAtLeast(have: Tier | null | undefined, need: Tier): boolean {
  if (!have) return false;
  return (RANK[have] ?? -1) >= (RANK[need] ?? 0);
}

/** Normalize legacy tier strings into the current 2-tier model. */
export function normalizeTier(raw: string | null | undefined): Tier | null {
  if (!raw) return null;
  const s = String(raw).toLowerCase().trim();
  if (s === "pup" || s === "free") return "pup";
  if (s === "all_access" || s === "top_dog" || s === "kennel_club" || s === "scout" || s === "legacy") return "all_access";
  return null;
}

/** Resolve the tier for a given email by reading bot_access_passwords. */
export async function resolveTierForEmail(supabase: any, email: string | null | undefined): Promise<Tier | null> {
  if (!email) return null;
  const normalized = String(email).trim().toLowerCase();
  const { data } = await supabase
    .from("bot_access_passwords")
    .select("tier, created_at")
    .ilike("email", normalized)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return normalizeTier(data?.tier);
}

/** Spike's locked-tool refusal payload. UI surfaces an Upgrade CTA when upsell=true. */
export function lockedToolResponse(reason: string) {
  return {
    error: "tier_locked",
    upsell: true,
    message: `${reason} That one lives on the Telegram bot — All-Access unlocks it.`,
    upgrade_url: "/upgrade",
  };
}