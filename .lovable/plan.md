

## Switch Edge Functions from Lovable AI to OpenAI

### Overview
Update all edge functions currently using `LOVABLE_API_KEY` and `ai.gateway.lovable.dev` to use your existing `OPENAI_API_KEY` with OpenAI's API directly.

---

### Functions to Update

| Function | Purpose | Model Change |
|----------|---------|--------------|
| `generate-roasts` | Parlay roasting | gemini-2.5-flash → gpt-4o-mini |
| `betting-calendar-insights` | Calendar AI tips | gemini-2.5-flash → gpt-4o-mini |
| `analyze-live-frame` | Live game vision | gemini-2.5-flash → gpt-4o (vision) |
| `scout-agent-loop` | Scout vision + analysis | gemini-2.5-flash → gpt-4o (vision) |
| `analyze-game-footage` | Game footage analysis | gemini-2.5-flash → gpt-4o (vision) |
| `compile-halftime-analysis` | Halftime synthesis | gemini-2.5-flash → gpt-4o-mini |
| `extract-parlay` | Already uses OpenAI primary | Keep as-is |

---

### Changes Per Function

**API Endpoint Change:**
```
BEFORE: https://ai.gateway.lovable.dev/v1/chat/completions
AFTER:  https://api.openai.com/v1/chat/completions
```

**Auth Header Change:**
```
BEFORE: Authorization: Bearer ${LOVABLE_API_KEY}
AFTER:  Authorization: Bearer ${OPENAI_API_KEY}
```

**Model Mapping:**
- Text-only tasks → `gpt-4o-mini` (fast, cheap)
- Vision tasks → `gpt-4o` (supports images)

---

### Technical Changes

**For each function:**

1. Replace secret key retrieval:
```typescript
// BEFORE
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

// AFTER
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
```

2. Replace API endpoint:
```typescript
// BEFORE
const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {

// AFTER
const response = await fetch("https://api.openai.com/v1/chat/completions", {
```

3. Update authorization header:
```typescript
// BEFORE
Authorization: `Bearer ${LOVABLE_API_KEY}`,

// AFTER
Authorization: `Bearer ${OPENAI_API_KEY}`,
```

4. Update model name:
```typescript
// BEFORE (text tasks)
model: "google/gemini-2.5-flash",

// AFTER (text tasks)
model: "gpt-4o-mini",

// BEFORE (vision tasks)
model: "google/gemini-2.5-flash",

// AFTER (vision tasks)
model: "gpt-4o",
```

5. Update error messages and logs to reference OpenAI instead of Lovable AI

---

### Vision-Specific Adjustments

For functions with image analysis (`analyze-live-frame`, `scout-agent-loop`, `analyze-game-footage`), ensure message format matches OpenAI vision format:

```typescript
messages: [
  {
    role: "user",
    content: [
      { type: "text", text: prompt },
      { type: "image_url", image_url: { url: `data:image/jpeg;base64,${frame}` } }
    ]
  }
]
```

---

### Summary

| Item | Count |
|------|-------|
| Functions to update | 6 |
| Already using OpenAI | 2 (fetch-injury-updates, fetch-player-context) |
| Vision functions | 3 |
| Text-only functions | 3 |

All AI calls will now use your OpenAI API key, giving you full control over usage and billing through your OpenAI account.

