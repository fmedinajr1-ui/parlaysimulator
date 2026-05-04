// Combined daily quota for Free (Pup) tier: 1 action per ET day total
// (a parlay build OR a slip scan — not both).
// Used by live-ai-agent's build_parlay and analyze_slip tools.

const DAILY_LIMIT = 1;

function etDateKey(): string {
  // YYYY-MM-DD in America/New_York
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

export type QuotaResult =
  | { allowed: true; remaining: number }
  | { allowed: false; remaining: 0; reason: "daily_limit_reached" };

/** Atomically increment & check the Pup combined-action counter for today. */
export async function consumePupAction(supabase: any, email: string | null | undefined): Promise<QuotaResult> {
  if (!email) return { allowed: false, remaining: 0, reason: "daily_limit_reached" };
  const normalized = String(email).trim().toLowerCase();
  const ymd = etDateKey();

  // Read current count
  const { data: existing } = await supabase
    .from("pup_daily_quota")
    .select("actions_used")
    .eq("email", normalized)
    .eq("ymd_et", ymd)
    .maybeSingle();

  const current = existing?.actions_used ?? 0;
  if (current >= DAILY_LIMIT) {
    return { allowed: false, remaining: 0, reason: "daily_limit_reached" };
  }

  const next = current + 1;
  const { error } = await supabase
    .from("pup_daily_quota")
    .upsert(
      { email: normalized, ymd_et: ymd, actions_used: next, updated_at: new Date().toISOString() },
      { onConflict: "email,ymd_et" },
    );

  if (error) {
    console.warn("[pup-quota] upsert failed", error);
    // Fail-closed to avoid abuse
    return { allowed: false, remaining: 0, reason: "daily_limit_reached" };
  }

  return { allowed: true, remaining: Math.max(0, DAILY_LIMIT - next) };
}

/** Read-only check of Pup quota state — does NOT consume. */
export async function getPupQuotaState(supabase: any, email: string | null | undefined): Promise<{ used: number; remaining: number }> {
  if (!email) return { used: 0, remaining: DAILY_LIMIT };
  const normalized = String(email).trim().toLowerCase();
  const ymd = etDateKey();
  const { data } = await supabase
    .from("pup_daily_quota")
    .select("actions_used")
    .eq("email", normalized)
    .eq("ymd_et", ymd)
    .maybeSingle();
  const used = data?.actions_used ?? 0;
  return { used, remaining: Math.max(0, DAILY_LIMIT - used) };
}