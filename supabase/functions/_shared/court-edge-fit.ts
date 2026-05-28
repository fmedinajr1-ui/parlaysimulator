// Court.Edge v3 — per-surface player fit loader.
// Reads from public.court_edge_player_fit. Missing rows default to 0.65 so the
// v3 weak-fit gate stays inert until the backfill job populates real values.

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

export const NEUTRAL_FIT = 0.65;

export type SurfaceFit = "clay" | "hard" | "grass";

export async function loadPlayerFit(
  supabase: SupabaseClient,
  slugs: string[],
  surface: SurfaceFit,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const uniq = Array.from(new Set(slugs.filter(Boolean)));
  if (uniq.length === 0) return out;
  try {
    const { data, error } = await supabase
      .from("court_edge_player_fit")
      .select("player_slug, fit")
      .eq("surface", surface)
      .in("player_slug", uniq);
    if (error) {
      console.warn("[v3 fit] load error:", error.message);
      return out;
    }
    for (const row of data ?? []) {
      const f = Number((row as { fit: number | string }).fit);
      if (Number.isFinite(f)) out.set((row as { player_slug: string }).player_slug, f);
    }
  } catch (e) {
    console.warn("[v3 fit] exception:", (e as Error).message);
  }
  return out;
}

export function fitFor(map: Map<string, number>, slug: string | null | undefined): number {
  if (!slug) return NEUTRAL_FIT;
  const v = map.get(slug);
  return Number.isFinite(v as number) ? (v as number) : NEUTRAL_FIT;
}

// Helper for callers that already have a supabase URL/key but no client instance.
export function makeFitClient(url: string, serviceKey: string): SupabaseClient {
  return createClient(url, serviceKey, { auth: { persistSession: false } });
}