

## Fix: Capture and Log Upsert Error in Matchup Defense Scanner

### Problem

The scanner successfully processes 53 recommendations but the final upsert to `bot_research_findings` silently fails -- the result/error from the upsert call on line 300 is never captured or logged, so we can't see why it fails.

### Changes

**File: `supabase/functions/bot-matchup-defense-scanner/index.ts`**

1. **Capture upsert result** -- Change line 300 from:
   ```
   await supabase.from('bot_research_findings').upsert({...});
   ```
   to:
   ```
   const { error: upsertError } = await supabase.from('bot_research_findings').upsert({...});
   ```

2. **Log and handle the error** -- After the upsert, add:
   ```
   if (upsertError) {
     console.error('[MatchupScanner] Upsert failed:', upsertError);
     // Fallback: try a plain insert if upsert fails
     const { error: insertError } = await supabase
       .from('bot_research_findings')
       .insert({...same payload but with id: crypto.randomUUID()...});
     if (insertError) {
       console.error('[MatchupScanner] Insert fallback also failed:', insertError);
     }
   } else {
     console.log('[MatchupScanner] Successfully wrote matchup scan to bot_research_findings');
   }
   ```

3. **Verify after deploy** -- Re-run the scanner and check both the response and the database for the written row.

This approach will either fix the write (if it was a transient issue) or give us the exact error message to diagnose the root cause.
