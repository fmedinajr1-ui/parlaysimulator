// Court.Edge — Open-Meteo weather lookup with 1h cache per city.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CACHE_TTL_MS = 60 * 60 * 1000;

async function geocode(city: string): Promise<{ lat: number; lon: number } | null> {
  const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1`);
  if (!r.ok) return null;
  const j = await r.json().catch(() => null);
  const hit = j?.results?.[0];
  if (!hit) return null;
  return { lat: hit.latitude, lon: hit.longitude };
}

async function currentWeather(lat: number, lon: number) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,wind_speed_10m&temperature_unit=fahrenheit&wind_speed_unit=mph`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`forecast ${r.status}`);
  const j = await r.json();
  const c = j?.current || {};
  return {
    temp_f: Number(c.temperature_2m ?? null),
    humidity: Number(c.relative_humidity_2m ?? null),
    wind_mph: Number(c.wind_speed_10m ?? null),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const body = (await req.json().catch(() => ({}))) as { city?: string };
    const city = (body.city || "").trim();
    if (!city) {
      return new Response(JSON.stringify({ ok: false, error: "city required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    try {
      const { data: cached } = await supabase
        .from("court_edge_weather_cache")
        .select("temp_f,humidity,wind_mph,fetched_at")
        .eq("city", city)
        .maybeSingle();
      if (cached && Date.now() - Date.parse(cached.fetched_at) < CACHE_TTL_MS) {
        return new Response(JSON.stringify({ ok: true, city, weather: cached, cached: true }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    } catch (e) {
      console.error("[court-edge-fetch-weather] cache read", e);
    }

    const geo = await geocode(city);
    if (!geo) {
      return new Response(JSON.stringify({ ok: false, error: `geocode failed for ${city}` }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const w = await currentWeather(geo.lat, geo.lon);
    try {
      await supabase.from("court_edge_weather_cache").upsert({
        city, ...w, fetched_at: new Date().toISOString(),
      }, { onConflict: "city" });
    } catch (e) {
      console.error("[court-edge-fetch-weather] cache write", e);
    }
    return new Response(JSON.stringify({ ok: true, city, weather: w, cached: false }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});