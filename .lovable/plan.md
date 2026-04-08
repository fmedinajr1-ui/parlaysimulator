

# Fix: fanduel-behavior-analyzer Syntax Error

## Problem
The function crashes on boot with `Uncaught SyntaxError: Unexpected reserved word` at line 1577. The root cause is an `await` used inside a **non-async** `.map()` callback starting at line 1479.

The `.map((a) => {` block (lines 1479-1547) calls `await fetchRealAltLine(...)` on line 1523, but the callback is not declared `async`. Deno's TypeScript compiler catches this as a reserved word error.

## Fix

**File: `supabase/functions/fanduel-behavior-analyzer/index.ts`**

1. Change line 1479 from `.map((a) => {` to `.map(async (a) => {`
2. Since `.map(async ...)` returns an array of Promises, wrap the result: change lines 1470-1547 to use `await Promise.all(...)` so `predRows` resolves to actual data instead of unresolved promises.

Specifically:
- Line 1470: `const predRows = (await Promise.all(gatedAlerts`
- Line 1479: `.map(async (a) => {`
- Line 1547: `}))).filter(Boolean);` (to handle any nulls)

This is a one-line-class fix — the function will boot and run correctly after this change.

