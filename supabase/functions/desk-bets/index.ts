// deno-lint-ignore-file no-explicit-any
import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "npm:zod@3";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

const Bet = z.object({
  player_name: z.string().min(1).max(80),
  stat: z.enum(["points", "rebounds", "assists", "threes_made", "pra"]),
  side: z.enum(["over", "under"]),
  line: z.number().min(0).max(200),
  odds: z.number().int().refine((o) => Math.abs(o) >= 100 && Math.abs(o) <= 100000),
  stake: z.number().positive().max(1_000_000),
  book: z.string().max(40).nullable().optional(),
  game_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  placed_at: z.string().optional(),
});
const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("list"), passcode: z.string() }),
  z.object({ action: z.literal("add"), passcode: z.string(), bets: z.array(Bet).min(1).max(200) }),
  z.object({ action: z.literal("delete"), passcode: z.string(), id: z.string().uuid() }),
]);

/** Private bet log for the desk; every call must carry the desk passcode. */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: parsed.error.flatten() }, 400);
  const b = parsed.data;
  const expected = Deno.env.get("DESK_PASSCODE") ?? "";
  if (!expected || b.passcode !== expected) {
    await new Promise((r) => setTimeout(r, 800));
    return json({ error: "Wrong passcode" }, 401);
  }
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  if (b.action === "add") {
    const { error } = await sb.from("research_real_bets").insert(b.bets);
    if (error) return json({ error: error.message }, 500);
  }
  if (b.action === "delete") {
    const { error } = await sb.from("research_real_bets").delete().eq("id", b.id);
    if (error) return json({ error: error.message }, 500);
  }
  const { data, error } = await sb.from("research_real_bets").select("*").order("placed_at", { ascending: false }).limit(2000);
  if (error) return json({ error: error.message }, 500);
  return json({ bets: data });
});
