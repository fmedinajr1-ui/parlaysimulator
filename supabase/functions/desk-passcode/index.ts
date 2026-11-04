const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  try {
    const { passcode } = await req.json();
    const expected = Deno.env.get("DESK_PASSCODE") ?? "";
    const ok = !!expected && typeof passcode === "string" && passcode === expected;
    if (!ok) await new Promise((r) => setTimeout(r, 800));
    return new Response(JSON.stringify({ ok }), { headers: { ...cors, "Content-Type": "application/json" } });
  } catch {
    return new Response(JSON.stringify({ ok: false }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });
  }
});
