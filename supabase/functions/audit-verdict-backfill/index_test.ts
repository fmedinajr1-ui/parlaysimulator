import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';

// Mirror of internal helpers (kept in sync with index.ts)
function parseLine(metadata: Record<string, unknown> | null, prediction: string) {
  const sideRaw = (prediction || '').trim();
  let side: 'Over' | 'Under' | null = null;
  if (/^over$/i.test(sideRaw)) side = 'Over';
  else if (/^under$/i.test(sideRaw)) side = 'Under';
  let line: number | null = null;
  const ml = metadata?.line;
  if (ml != null) {
    const n = Number(ml);
    if (Number.isFinite(n)) line = n;
  }
  if (line == null) {
    const m = sideRaw.match(/(\d+(?:\.\d+)?)/);
    if (m) line = Number(m[1]);
  }
  return { side, line };
}

function settle(side: 'Over' | 'Under', line: number, actual: number) {
  return side === 'Over' ? actual > line : actual < line;
}

function etDate(ts: string): string {
  return new Date(ts).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

Deno.test('1. parseLine pulls Over + line from metadata', () => {
  const { side, line } = parseLine({ line: 12.5 }, 'Over');
  assertEquals(side, 'Over');
  assertEquals(line, 12.5);
});

Deno.test('2. parseLine falls back to regex on prediction string', () => {
  const { side, line } = parseLine(null, 'Under 27.5');
  assertEquals(side, 'Under');
  assertEquals(line, 27.5);
});

Deno.test('3. settle Over wins when actual exceeds line', () => {
  assertEquals(settle('Over', 12.5, 14), true);
  assertEquals(settle('Over', 12.5, 12), false);
  assertEquals(settle('Over', 12.5, 12.5), false); // strict greater
});

Deno.test('4. settle Under wins when actual below line', () => {
  assertEquals(settle('Under', 27.5, 22), true);
  assertEquals(settle('Under', 27.5, 30), false);
});

Deno.test('5. etDate normalises late-night UTC to ET prior day', () => {
  // 2026-05-04 02:00 UTC == 2026-05-03 22:00 ET
  assertEquals(etDate('2026-05-04T02:00:00Z'), '2026-05-03');
  // Mid-day UTC == same ET date
  assertEquals(etDate('2026-05-04T18:00:00Z'), '2026-05-04');
});