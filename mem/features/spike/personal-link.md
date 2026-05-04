---
name: Spike personal share link
description: Every signed-in user gets a permanent /spike/:token URL via profiles.spike_share_token; share_my_link tool surfaces it; SpikeShareCard renders it.
type: feature
---
- DB: `profiles.spike_share_token` (unique, auto-generated). RPCs: `get_my_spike_token()` (returns/mints current user's token), `resolve_spike_token(text)` (server-side lookup).
- Route: `/spike/:token` maps to `LiveAI`. Anonymous visitors get bounced to `/?next=/spike/:token`.
- Edge function `live-ai-agent` exposes `share_my_link` tool — anon/sample stripped from the registry. Response payload includes `share_link` when emitted.
- UI: `SpikeShareCard` (banner + inline variants) handles copy / SMS / Web Share. Banner auto-shows once after wake for signed-in users; inline variant renders under any agent message that returned `share_link`.
- Persona: anonymous users get betting education + general chat; specific picks/parlays/whale reads/share link all gated. Refusals stay in-character with an upsell to `/upgrade`.