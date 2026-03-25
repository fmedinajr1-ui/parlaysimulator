
# Fix Lottery Scanner — Real Lines + DNA Audit ✅ COMPLETED

## Problems Fixed
1. ✅ Ghost lines removed — no more fabricated fake lines
2. ✅ Alt line swaps now properly invalidate `hasRealLine` flag
3. ✅ Minimum 3-leg requirement enforced (was 2, causing preflight integrity failures)
4. ✅ Cross-verification against `unified_props` added — stale/diverged lines get -10 penalty
5. ✅ DNA-compatible fields enriched on all lottery legs
6. ✅ Lottery generation properly ordered before DNA audit in orchestrator
