// Regression: per-sport slip routing in the analyzer.
//
// These tests use a fake Supabase client that records every query (table,
// .ilike, .eq, .in filters) issued by gatherEngineHits + findTopSwap. They
// then assert:
//   1. Every leg is detected as the right sport.
//   2. Every sport-aware engine query carries .in('sport', [<aliases for that sport>]).
//   3. NBA aliases (basketball_nba / NBA / nba) NEVER appear on queries for
//      MLB, NHL, NFL, or Tennis legs.
//   4. Non-NBA aliases never appear on queries for NBA legs.
//   5. Swap suggestions for non-NBA legs only pull from their own sport's pool.
//
// Per the project memory `constraints/testing-policy`, this file ships the
// required ≥5 independent verifications for the sport-routing change.

import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { gatherEngineHits, findTopSwap } from './index.ts';
import { detectSport, parseLeg, SPORT_ALIASES, type SportKey } from '../_shared/leg-matcher.ts';

// ─── Fake Supabase client ────────────────────────────────────────────────

interface QueryRecord {
  table: string;
  filters: Array<{ op: string; col?: string; values?: unknown }>;
}

function makeFakeSupabase(opts: { rowsByTable?: Record<string, unknown[]> } = {}) {
  const recorded: QueryRecord[] = [];
  const rowsByTable = opts.rowsByTable ?? {};

  function makeBuilder(table: string): any {
    const rec: QueryRecord = { table, filters: [] };
    recorded.push(rec);
    const data = rowsByTable[table] ?? [];

    const builder: any = {
      select() { return builder; },
      ilike(col: string, val: string) { rec.filters.push({ op: 'ilike', col, values: val }); return builder; },
      eq(col: string, val: unknown) { rec.filters.push({ op: 'eq', col, values: val }); return builder; },
      in(col: string, vals: unknown[]) { rec.filters.push({ op: 'in', col, values: vals }); return builder; },
      gte(col: string, val: unknown) { rec.filters.push({ op: 'gte', col, values: val }); return builder; },
      order() { return builder; },
      limit() { return builder; },
      // Awaiting the builder resolves to a PostgrestResponse-like shape.
      then(onFulfilled: any, onRejected: any) {
        return Promise.resolve({ data, error: null }).then(onFulfilled, onRejected);
      },
    };
    return builder;
  }

  const client: any = { from(table: string) { return makeBuilder(table); } };
  return { client, recorded };
}

/** Pull every .in('sport', [...]) call out of the recorded queries. */
function sportFilters(recorded: QueryRecord[]): Array<{ table: string; values: string[] }> {
  return recorded.flatMap((q) =>
    q.filters
      .filter((f) => f.op === 'in' && f.col === 'sport')
      .map((f) => ({ table: q.table, values: f.values as string[] }))
  );
}

const NBA_ALIASES_LOWER = SPORT_ALIASES.NBA.map((a) => a.toLowerCase());

function containsAnyNbaAlias(values: string[]): boolean {
  return values.some((v) => NBA_ALIASES_LOWER.includes(String(v).toLowerCase()));
}

const TODAY = '2026-04-27';

// ─── Test 1: NBA slip routes to NBA aliases only ─────────────────────────

Deno.test('NBA points leg → only NBA aliases on every sport-filtered query', async () => {
  const leg = { description: 'LeBron James Over 25.5 Points', odds: -110 };
  const parsed = parseLeg(leg);
  const detected = detectSport({ raw: leg.description, propType: parsed.propType }, undefined);
  assertEquals(detected.sport, 'NBA');

  const { client, recorded } = makeFakeSupabase();
  await gatherEngineHits(client, parsed, detected.sport as SportKey, TODAY);

  const filters = sportFilters(recorded);
  assert(filters.length >= 4, `expected ≥4 sport filters, got ${filters.length}`);
  for (const f of filters) {
    // Every sport filter must be exactly the NBA alias set
    assertEquals(f.values.sort(), [...SPORT_ALIASES.NBA].sort(), `${f.table} got wrong aliases`);
  }
});

// ─── Test 2: MLB slip never touches NBA aliases ──────────────────────────

Deno.test('MLB Home Runs leg → MLB aliases only, NEVER NBA aliases', async () => {
  const leg = { description: 'Aaron Judge Over 0.5 Home Runs', odds: +180 };
  const parsed = parseLeg(leg);
  const detected = detectSport({ raw: leg.description, propType: parsed.propType }, undefined);
  assertEquals(detected.sport, 'MLB');

  const { client, recorded } = makeFakeSupabase();
  await gatherEngineHits(client, parsed, detected.sport as SportKey, TODAY);

  const filters = sportFilters(recorded);
  assert(filters.length > 0, 'expected sport filters to be applied for MLB leg');
  for (const f of filters) {
    assert(!containsAnyNbaAlias(f.values), `${f.table} leaked NBA alias: ${f.values.join(',')}`);
    assertEquals(f.values.sort(), [...SPORT_ALIASES.MLB].sort());
  }
});

// ─── Test 3: NHL slip never touches NBA aliases ──────────────────────────

Deno.test('NHL Shots on Goal leg → NHL aliases only, NEVER NBA aliases', async () => {
  const leg = { description: 'Connor McDavid Over 3.5 Shots on Goal', odds: -120 };
  const parsed = parseLeg(leg);
  const detected = detectSport({ raw: leg.description, propType: parsed.propType }, undefined);
  assertEquals(detected.sport, 'NHL');

  const { client, recorded } = makeFakeSupabase();
  await gatherEngineHits(client, parsed, detected.sport as SportKey, TODAY);

  const filters = sportFilters(recorded);
  assert(filters.length > 0);
  for (const f of filters) {
    assert(!containsAnyNbaAlias(f.values), `${f.table} leaked NBA alias for NHL leg`);
    assertEquals(f.values.sort(), [...SPORT_ALIASES.NHL].sort());
  }
});

// ─── Test 4: NFL slip never touches NBA aliases ──────────────────────────

Deno.test('NFL Receiving Yards leg → NFL aliases only, NEVER NBA aliases', async () => {
  const leg = { description: 'Tyreek Hill Over 75.5 Receiving Yards', odds: -115 };
  const parsed = parseLeg(leg);
  const detected = detectSport({ raw: leg.description, propType: parsed.propType }, undefined);
  assertEquals(detected.sport, 'NFL');

  const { client, recorded } = makeFakeSupabase();
  await gatherEngineHits(client, parsed, detected.sport as SportKey, TODAY);

  const filters = sportFilters(recorded);
  assert(filters.length > 0);
  for (const f of filters) {
    assert(!containsAnyNbaAlias(f.values), `${f.table} leaked NBA alias for NFL leg`);
    assertEquals(f.values.sort(), [...SPORT_ALIASES.NFL].sort());
  }
});

// ─── Test 5: Tennis slip never touches NBA aliases ───────────────────────

Deno.test('Tennis Aces leg → TENNIS aliases only, NEVER NBA aliases', async () => {
  const leg = { description: 'Djokovic Over 8.5 Aces', odds: -110 };
  const parsed = parseLeg(leg);
  const detected = detectSport({ raw: leg.description, propType: parsed.propType }, undefined);
  assertEquals(detected.sport, 'TENNIS');

  const { client, recorded } = makeFakeSupabase();
  await gatherEngineHits(client, parsed, detected.sport as SportKey, TODAY);

  const filters = sportFilters(recorded);
  assert(filters.length > 0);
  for (const f of filters) {
    assert(!containsAnyNbaAlias(f.values), `${f.table} leaked NBA alias for Tennis leg`);
    assertEquals(f.values.sort(), [...SPORT_ALIASES.TENNIS].sort());
  }
});

// ─── Test 6: Mixed slip routes each leg independently ────────────────────

Deno.test('Mixed NBA + MLB + NHL slip → each leg fires queries with its own sport aliases', async () => {
  const legs = [
    { description: 'LeBron James Over 25.5 Points', odds: -110, expect: 'NBA' as SportKey },
    { description: 'Aaron Judge Over 0.5 Home Runs', odds: +180, expect: 'MLB' as SportKey },
    { description: 'Connor McDavid Over 3.5 Shots on Goal', odds: -120, expect: 'NHL' as SportKey },
  ];

  for (const leg of legs) {
    const parsed = parseLeg(leg);
    const detected = detectSport({ raw: leg.description, propType: parsed.propType }, undefined);
    assertEquals(detected.sport, leg.expect, `wrong sport for "${leg.description}"`);

    const { client, recorded } = makeFakeSupabase();
    await gatherEngineHits(client, parsed, detected.sport as SportKey, TODAY);
    const filters = sportFilters(recorded);

    const expected = [...SPORT_ALIASES[leg.expect]].sort();
    for (const f of filters) {
      assertEquals(f.values.sort(), expected, `cross-sport leak in ${f.table} for ${leg.expect}`);
    }
  }
});

// ─── Test 7: Swap suggestions for MLB legs only pull MLB aliases ─────────

Deno.test('findTopSwap for MLB leg filters unified_props by MLB aliases only', async () => {
  const parsed = parseLeg({ description: 'Aaron Judge Over 0.5 Home Runs', odds: +180 });
  const { client, recorded } = makeFakeSupabase();
  await findTopSwap(client, parsed, 'MLB', TODAY);

  const unifiedFilters = sportFilters(recorded).filter((f) => f.table === 'unified_props');
  assert(unifiedFilters.length > 0, 'expected unified_props sport filter on swap query');
  for (const f of unifiedFilters) {
    assert(!containsAnyNbaAlias(f.values), 'swap query leaked NBA aliases for MLB leg');
    assertEquals(f.values.sort(), [...SPORT_ALIASES.MLB].sort());
  }
});