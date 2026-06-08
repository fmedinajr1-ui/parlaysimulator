// Optional direct-to-Supabase upload from the worker.
// If SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are set, the worker can write
// rows itself (skip the bridge edge function). Default behavior is to just
// return scraped JSON and let the edge function handle the insert.
import { createClient } from "@supabase/supabase-js";

let client = null;
export function getSupabase() {
  if (client) return client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  client = createClient(url, key, { auth: { persistSession: false } });
  return client;
}

export async function uploadMarketSnapshot(rows) {
  const sb = getSupabase();
  if (!sb || !rows?.length) return { uploaded: 0 };
  const { error } = await sb.from("market_snapshot").insert(rows);
  if (error) {
    console.warn("[hr-supabase] insert error:", error.message);
    return { uploaded: 0, error: error.message };
  }
  return { uploaded: rows.length };
}