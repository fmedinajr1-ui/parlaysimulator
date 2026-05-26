// Shared HMAC-SHA256 verifier for Scout Speed Edge ingest webhooks.
// Header: X-Webhook-Signature: sha256=<hex>

export async function verifyHmac(
  rawBody: string,
  headerValue: string | null,
  secret: string | undefined,
): Promise<boolean> {
  if (!secret) return true; // Secret not configured → skip (dev). Configure in prod.
  if (!headerValue) return false;
  const provided = headerValue.replace(/^sha256=/, "").trim().toLowerCase();
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const hex = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  if (hex.length !== provided.length) return false;
  let diff = 0;
  for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ provided.charCodeAt(i);
  return diff === 0;
}