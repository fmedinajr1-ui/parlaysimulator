# OCR Auto-Fill → Editable Legs Table

## Problem
Right now the slip grader has two disconnected modes:
- **Paste**: user types every leg by hand
- **Screenshot**: OCR runs and the result goes *straight* to grading — user has no chance to fix typos, missing odds, or wrong sides

There is no shared "editable legs table" UI. If OCR misreads "Tatum 27.5" as "Tatum 21.5", the grade is wrong and the user can't fix it. We need OCR → review/edit → grade.

## Solution
Replace both modes with a single unified flow:

1. User uploads a screenshot (or pastes text as fallback)
2. OCR runs via existing `extract-parlay` edge function
3. Extracted legs land in a new **editable legs table** (player, prop, line, side, odds — all editable inline)
4. User can add/remove/edit rows
5. "Grade slip" button sends the cleaned legs to `grade-slip`

## What we'll build

### New component: `EditableLegsTable.tsx`
- Rows with inline inputs: `player`, `prop type` (select), `line` (number), `side` (Over/Under toggle), `odds` (number)
- Per-row delete button + "Add leg" button at bottom
- Confidence indicator on rows that came from OCR (low-confidence rows highlighted yellow so user knows to double-check)
- Empty state with "Upload screenshot" or "Paste text" CTAs

### Refactor: `InlineSlipGraderPromo.tsx`
Three states instead of two modes:
- **Empty** — upload screenshot / paste text / start blank
- **Editing** — `EditableLegsTable` populated from OCR or paste; "Grade my slip" button
- **Result** — existing `GradeReveal` + `EmailGate`

OCR flow becomes:
```
upload → extract-parlay → legs → setLegs() → editable table → user reviews → grade-slip
```

Paste flow becomes:
```
paste → quick parser (existing line-by-line) → setLegs() → editable table → grade-slip
```

### Refactor: `farm/UploadForm.tsx`
Same upgrade — replace the textarea with the upload-or-paste flow plus `EditableLegsTable`. Keep the email capture (still saves to `leads` table after grading).

### Edge function: no changes needed
`extract-parlay` already returns structured `{ player, propType, line, side, odds }`. `grade-slip` already accepts that shape.

## Technical notes
- Prop type select uses the same canonical list `ocr-prop-scan` already normalizes (points, rebounds, assists, threes, pra, hits, total_bases, strikeouts, passing_yards, etc.)
- OCR confidence (when present) drives the per-row warning highlight
- If OCR returns zero legs, show the "Couldn't read slip" nudge (`ClearerScreenshotNudge`) and let user paste or hand-build legs in the empty table
- Mobile: the table collapses to stacked cards (one card per leg) at < 640px since the user is on a 402px viewport

## Files
```text
NEW   src/components/grade/EditableLegsTable.tsx
EDIT  src/components/grade/InlineSlipGraderPromo.tsx   (wire OCR/paste → table → grade)
EDIT  src/components/farm/UploadForm.tsx               (same flow, keep email capture)
```

No DB migration, no new edge function, no new secrets.
