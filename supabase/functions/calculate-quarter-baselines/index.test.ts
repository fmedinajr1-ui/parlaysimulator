import "https://deno.land/std@0.224.0/dotenv/load.ts";
import { assertEquals, assertExists } from "https://deno.land/std@0.224.0/assert/mod.ts";

const SUPABASE_URL = Deno.env.get("VITE_SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("VITE_SUPABASE_PUBLISHABLE_KEY")!;

const FUNCTION_URL = `${SUPABASE_URL}/functions/v1/calculate-quarter-baselines`;

Deno.test("calculate-quarter-baselines - OPTIONS returns CORS headers", async () => {
  const response = await fetch(FUNCTION_URL, {
    method: "OPTIONS",
    headers: {
      "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
    },
  });

  assertEquals(response.status, 200);
  assertEquals(response.headers.get("Access-Control-Allow-Origin"), "*");
  
  // Consume the body to prevent resource leak
  await response.text();
});

Deno.test("calculate-quarter-baselines - POST executes successfully", async () => {
  const response = await fetch(FUNCTION_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
    },
  });

  assertEquals(response.status, 200);
  
  const result = await response.json();
  
  // Verify response structure
  assertExists(result.success);
  assertExists(result.playersProcessed);
  assertExists(result.baselinesGenerated);
  assertExists(result.timestamp);
  
  assertEquals(result.success, true);
  assertEquals(typeof result.playersProcessed, "number");
  assertEquals(typeof result.baselinesGenerated, "number");
});

Deno.test("calculate-quarter-baselines - returns proper timestamp format", async () => {
  const response = await fetch(FUNCTION_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
    },
  });

  assertEquals(response.status, 200);
  
  const result = await response.json();
  
  // Verify timestamp is valid ISO format
  const timestamp = new Date(result.timestamp);
  assertEquals(isNaN(timestamp.getTime()), false);
});

Deno.test("calculate-quarter-baselines - handles GET method", async () => {
  const response = await fetch(FUNCTION_URL, {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
    },
  });

  // Should still work (the function doesn't restrict to POST only)
  // OR return appropriate error
  const text = await response.text();
  assertExists(text);
});
