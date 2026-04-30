// Tournament metadata for surface, sets format, indoor, and weather city.

import type { Surface, SetsFormat } from "./court-edge-projection.ts";

export interface TournamentMeta {
  name: string;
  surface: Surface;
  sets_format: SetsFormat;
  indoor: boolean;
  city: string; // for weather lookup
}

// Match against sport_key fragments and event/tournament name fragments.
// First match wins; default below catches anything else.
const RULES: Array<{ test: RegExp; meta: TournamentMeta }> = [
  { test: /australian[_\s]?open|aus[_\s]?open|melbourne/i, meta: { name: "Australian Open", surface: "hard", sets_format: "bo5", indoor: false, city: "Melbourne" } },
  { test: /roland[_\s]?garros|french[_\s]?open|paris[_\s]?(roland|french)/i, meta: { name: "Roland Garros", surface: "clay", sets_format: "bo5", indoor: false, city: "Paris" } },
  { test: /wimbledon/i, meta: { name: "Wimbledon", surface: "grass", sets_format: "bo5", indoor: false, city: "London" } },
  { test: /us[_\s]?open|flushing/i, meta: { name: "US Open", surface: "hard", sets_format: "bo5", indoor: false, city: "New York" } },
  { test: /indian[_\s]?wells/i, meta: { name: "Indian Wells", surface: "hard", sets_format: "bo3", indoor: false, city: "Indian Wells" } },
  { test: /miami[_\s]?(open|masters)/i, meta: { name: "Miami Open", surface: "hard", sets_format: "bo3", indoor: false, city: "Miami" } },
  { test: /madrid/i, meta: { name: "Madrid Open", surface: "clay", sets_format: "bo3", indoor: false, city: "Madrid" } },
  { test: /rome|italian[_\s]?open/i, meta: { name: "Italian Open", surface: "clay", sets_format: "bo3", indoor: false, city: "Rome" } },
  { test: /monte[_\s]?carlo/i, meta: { name: "Monte Carlo Masters", surface: "clay", sets_format: "bo3", indoor: false, city: "Monte Carlo" } },
  { test: /barcelona/i, meta: { name: "Barcelona Open", surface: "clay", sets_format: "bo3", indoor: false, city: "Barcelona" } },
  { test: /cincinnati|cincy/i, meta: { name: "Cincinnati", surface: "hard", sets_format: "bo3", indoor: false, city: "Cincinnati" } },
  { test: /toronto|canadian[_\s]?open|montreal/i, meta: { name: "Canadian Open", surface: "hard", sets_format: "bo3", indoor: false, city: "Toronto" } },
  { test: /shanghai/i, meta: { name: "Shanghai Masters", surface: "hard", sets_format: "bo3", indoor: false, city: "Shanghai" } },
  { test: /paris[_\s]?(masters|bercy)|bercy/i, meta: { name: "Paris Masters", surface: "hard", sets_format: "bo3", indoor: true, city: "Paris" } },
  { test: /atp[_\s]?finals|wta[_\s]?finals|year[_\s]?end/i, meta: { name: "Tour Finals", surface: "hard", sets_format: "bo3", indoor: true, city: "Turin" } },
  { test: /vienna|erste[_\s]?bank/i, meta: { name: "Vienna Open", surface: "hard", sets_format: "bo3", indoor: true, city: "Vienna" } },
  { test: /basel/i, meta: { name: "Swiss Indoors Basel", surface: "hard", sets_format: "bo3", indoor: true, city: "Basel" } },
  { test: /rotterdam/i, meta: { name: "ABN AMRO Rotterdam", surface: "hard", sets_format: "bo3", indoor: true, city: "Rotterdam" } },
  { test: /dubai/i, meta: { name: "Dubai Championships", surface: "hard", sets_format: "bo3", indoor: false, city: "Dubai" } },
  { test: /doha|qatar/i, meta: { name: "Qatar Open", surface: "hard", sets_format: "bo3", indoor: false, city: "Doha" } },
];

const DEFAULT_META: TournamentMeta = {
  name: "Generic Tour Event",
  surface: "hard",
  sets_format: "bo3",
  indoor: false,
  city: "London",
};

export function detectTournament(...inputs: Array<string | undefined | null>): TournamentMeta {
  const haystack = inputs.filter(Boolean).join(" | ");
  for (const r of RULES) {
    if (r.test.test(haystack)) return r.meta;
  }
  return DEFAULT_META;
}

export const DEFAULT_TOURNAMENT = DEFAULT_META;