

## Test Plan: Customer Scout Command Center + Vision AI Pipeline

### Bugs Found During Code Review

#### Bug 1 (Critical): Demo Whale Signals Key Mismatch in AI Whisper
- **File**: `src/data/demoScoutData.ts` + `src/components/scout/CustomerAIWhisper.tsx`
- **Problem**: `demoWhaleSignals` uses keys like `"LeBron James_points"`, but `CustomerAIWhisper.generateInsights()` looks up signals using `signals?.get(pick.playerName.toLowerCase())` which produces `"lebron james"`. These keys never match, so STEAM/DIVERGENCE insights never appear in demo mode.
- **Fix**: Change demo map keys to match the lookup format (lowercase player name only), OR update the lookup to use `playerName_propType` format.

#### Bug 2 (Low): Double Frame Extraction
- **File**: `src/components/scout/ScoutVideoUpload.tsx`
- **Problem**: Frames are extracted once on file select (line ~63) and again on analyze (line ~100). The second extraction re-processes the entire video unnecessarily.
- **Fix**: Cache the extracted frames from the first pass and reuse on analyze.

#### Bug 3 (Info): Vision AI Uses Direct OpenAI Key
- **File**: `supabase/functions/analyze-game-footage/index.ts`
- **Problem**: The edge function calls `api.openai.com` directly with `OPENAI_API_KEY` instead of using the Lovable AI gateway (`ai.gateway.lovable.dev`). This works if the secret is configured, but doesn't leverage the built-in Lovable AI key.
- **Impact**: Not a bug if `OPENAI_API_KEY` is set. Migration to Lovable AI gateway is optional but would remove the API key dependency.

### Test Suite Implementation

Create comprehensive tests for all 7 customer modules plus the vision AI pipeline:

**New file: `src/test/scout-customer-view.test.tsx`**

Tests covering:

1. **Stream Panel** -- Renders game title, shows video placeholder
2. **Slip Scanner** -- Renders upload area, shows scanning state
3. **Sweet Spot Props** -- Renders loading state, handles empty data
4. **Hedge Panel** -- Renders empty state message, loading spinner
5. **Confidence Dashboard** -- Heat meter calculation, color thresholds, survival % math
6. **Risk Toggle** -- All 3 modes render, toggle changes mode, description updates
7. **AI Whisper** -- Insight generation logic, carousel rotation, signal detection
8. **Demo Mode** -- Banner renders, demo data flows to all modules
9. **Demo Whale Signals** -- Verify signal lookup actually matches (will catch Bug 1)

**New file: `src/test/video-frame-extractor.test.ts`**

Tests covering:

1. **validateVideoFile** -- Accepts MP4/MOV/WebM, rejects invalid types, enforces 100MB limit
2. **areFramesSimilar** -- Length-based comparison, sample matching, threshold behavior
3. **deduplicateFrames** -- Removes consecutive duplicates, keeps unique frames
4. **detectDuplicateFrameIssue** -- Identifies title-card-only extractions
5. **isVideoFile** -- Type detection for video files

**New file: `src/test/demo-scout-data.test.ts`**

Tests covering:

1. **Data integrity** -- All demo picks have required fields
2. **Whale signal key matching** -- Keys match the lookup format used by AI Whisper (catches Bug 1)
3. **Whisper picks** -- Have gameProgress field added

### Technical Details

- All tests use Vitest + React Testing Library
- Scout components that call Supabase are mocked at the module level
- RiskModeContext is wrapped around components that need it
- No edge function deployment needed -- these are pure frontend unit tests
- The Bug 1 fix changes 2 map keys in `demoScoutData.ts`
- The Bug 2 fix adds a `useRef` to cache frames between select and analyze in `ScoutVideoUpload.tsx`

### Files Changed

| File | Action |
|---|---|
| `src/data/demoScoutData.ts` | Fix -- correct whale signal map keys |
| `src/components/scout/ScoutVideoUpload.tsx` | Fix -- cache frames to avoid double extraction |
| `src/test/scout-customer-view.test.tsx` | Create -- 7-module test suite |
| `src/test/video-frame-extractor.test.ts` | Create -- frame extractor unit tests |
| `src/test/demo-scout-data.test.ts` | Create -- demo data integrity tests |
