
## Fix the bad engine selection, missing Sweet Spot picks, and Telegram truncation

### What will be fixed

Your screenshots point to three separate issues:

1. The wrong content is getting sent or prioritized, so a weaker engine is showing up instead of Sweet Spot.
2. Some parlay messages are poorly labeled (`uncategorized`) so you can’t tell why a pick was chosen.
3. Long Telegram messages are being cut off, so you can’t actually read the full output.

### Implementation plan

#### 1. Audit which engine produced each bad message and stop weak outputs from winning by default
I’ll trace the current Telegram sources and separate them by message type:
- Parlay engine broadcasts
- Sweet Spot broadcasts
- AI research digest
- Accuracy reports

Then I’ll add a strict source-aware routing rule so:
- Sweet Spot messages are sent as their own top-tier feed, not buried behind generic parlay output
- low-quality or fallback engine outputs don’t get promoted ahead of Sweet Spot
- every Telegram message clearly identifies its engine and strategy in readable terms

#### 2. Fix the “uncategorized” labeling in parlay messages
The screenshot shows legs rendering as `uncategorized · conf 0.86`, which means the message formatter is exposing raw or unmapped signal/category data.

I’ll normalize this so every leg shows:
- readable category name
- readable prop name
- readable reason label
- confidence only if useful

Example direction:
```text
Scoot Henderson — Rebounds + Assists OVER 5.5 (+105) [FD]
Volume Scorer · conf 0.86
```

If the source category is missing, the formatter will fall back to a safe human-readable label instead of `uncategorized`.

#### 3. Restore Sweet Spot as a first-class outbound message path
Right now the orchestration references `broadcast-sweet-spots`, but the source visible in the repo suggests Sweet Spot delivery is either missing, stale, or not guaranteed to run cleanly.

I’ll fix this by:
- verifying the Sweet Spot broadcaster path end-to-end
- ensuring Sweet Spot picks are pulled from `category_sweet_spots` for today’s ET date
- making the Sweet Spot broadcast fail loudly if no picks are sent, instead of silently disappearing
- keeping Sweet Spot separate from parlay-engine narratives so its best picks are always visible

If the broadcaster is missing or drifted from production, I’ll recreate it from current data contracts and wire it back into the daily flow.

#### 4. Add full Telegram message chunking so nothing gets cut off
The truncation in your screenshot is real. One function already hard-caps long messages and appends “Message truncated,” and the parlay broadcaster currently sends a single Telegram message without reusable chunking.

I’ll implement a shared Telegram chunking utility that:
- splits long messages safely before the Telegram character limit
- preserves formatting
- breaks on paragraph or section boundaries when possible
- numbers chunks like `(1/3), (2/3), (3/3)` so you can read everything in order
- keeps inline buttons only on the first chunk if needed

This chunker should be used in:
- parlay-engine-v2-broadcast
- AI research digest
- any shared Telegram sender path available in the project

Goal: no more silent cutoffs and no more “Message truncated” unless a hard external failure occurs.

#### 5. Fix engine accuracy reporting so the “worst engine” can be identified correctly
The current accuracy report shown in the code is based on `fanduel_prediction_accuracy`, which is not the same thing as:
- Sweet Spot performance
- parlay-engine-v2 performance
- research digest usefulness

I’ll split reporting by engine/source so you can compare:
- Sweet Spot hit rate
- parlay engine hit rate by strategy
- signal-type accuracy
- CLV vs outcome, where relevant

That will prevent one weak engine from hiding inside aggregate stats and will make it obvious when Sweet Spot is outperforming the rest.

#### 6. Add protections so weak engine output gets suppressed automatically
After the accuracy split is in place, I’ll add guardrails so a strategy can be muted or deprioritized when:
- recent hit rate falls below threshold
- too many “uncategorized” legs appear
- message quality fails formatting checks
- the engine is missing sufficient rationale/source tags

This keeps the bot from shipping junk just because a generator returned something.

### Files likely involved

- `supabase/functions/parlay-engine-v2-broadcast/index.ts`
- `supabase/functions/ai-research-agent/index.ts`
- shared Telegram sender utilities if present in the codebase
- Sweet Spot broadcaster function or its replacement
- accuracy reporting functions such as `supabase/functions/accuracy-report/index.ts`
- possibly `_shared` formatter/constants files for readable labels

### Technical details

#### Root causes already visible in code
- `ai-research-agent` explicitly hard-truncates long Telegram digests near 4000 chars and appends `Message truncated`
- `parlay-engine-v2-broadcast` sends a single Telegram message and does not appear to use shared chunking
- parlay message rendering uses raw `signal_source`, which explains labels like `uncategorized`
- Sweet Spot is referenced by orchestration, but the broadcaster source is not clearly present in the visible repo snapshot, so delivery may be missing, drifted, or silently failing
- current accuracy reporting is signal-based, not engine-based, so it can’t answer “which engine is actually worst?”

### Verification after implementation

I’ll verify with these checks:
1. A long Telegram digest arrives as multiple ordered chunks with no missing text.
2. A parlay message no longer shows `uncategorized`.
3. Sweet Spot picks are sent for today when eligible records exist.
4. Engine-by-engine accuracy output clearly separates Sweet Spot from parlay engine strategies.
5. Weak or malformed engine messages are suppressed instead of broadcast.

### Expected outcome

After this change:
- you’ll see the full Telegram content, not clipped fragments
- Sweet Spot will show up reliably when it has qualified picks
- bad engines won’t dominate just because they generated something
- every message will clearly explain what engine produced it and why
- accuracy will finally be attributable to the right source
