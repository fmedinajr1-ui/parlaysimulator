

## Plan: Change $20 Pre-Authorization to $50

### Changes Required

**2 files** need updating — both checkout edge functions:

#### 1. `supabase/functions/create-checkout/index.ts`
- Line 92: Change `unit_amount: 2000` → `unit_amount: 5000`
- Line 105: Update TOS message from "$20" → "$50"

#### 2. `supabase/functions/create-bot-checkout/index.ts`
- Line 78: Change `unit_amount: 2000` → `unit_amount: 5000`
- Lines 92-93: Update both TOS messages (scout and standard) from "$20" → "$50"

Both functions will be redeployed automatically.

