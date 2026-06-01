export type CrawlerCategory = "Scrapers" | "Fetchers" | "Injuries" | "FanDuel" | "Builders";

interface CrawlerJobDef {
  name: string;
  category: CrawlerCategory;
}

export const CRAWLER_JOBS: CrawlerJobDef[] = [
  // Scrapers
  { name: "pp-props-scraper", category: "Scrapers" },
  { name: "sportsbook-props-scraper", category: "Scrapers" },
  { name: "whale-odds-scraper", category: "Scrapers" },
  { name: "ncaab-kenpom-scraper", category: "Scrapers" },
  { name: "ncaab-referee-scraper", category: "Scrapers" },
  // Stats fetchers
  { name: "nba-stats-fetcher", category: "Fetchers" },
  { name: "nba-team-pace-fetcher", category: "Fetchers" },
  { name: "ncaa-baseball-team-stats-fetcher", category: "Fetchers" },
  { name: "ncaab-team-stats-fetcher", category: "Fetchers" },
  { name: "nfl-stats-fetcher", category: "Fetchers" },
  { name: "nfl-team-defense-fetcher", category: "Fetchers" },
  { name: "nhl-stats-fetcher", category: "Fetchers" },
  { name: "nhl-team-stats-fetcher", category: "Fetchers" },
  { name: "nhl-team-defense-rankings-fetcher", category: "Fetchers" },
  // Injuries
  { name: "fetch-mlb-injuries", category: "Injuries" },
  { name: "fetch-nfl-injuries", category: "Injuries" },
  { name: "fetch-nhl-injuries", category: "Injuries" },
  // FanDuel
  { name: "fanduel-line-scanner", category: "FanDuel" },
  { name: "fanduel-behavior-analyzer", category: "FanDuel" },
  { name: "fanduel-trap-scanner", category: "FanDuel" },
  { name: "fanduel-accuracy-feedback", category: "FanDuel" },
  { name: "fanduel-prediction-alerts", category: "FanDuel" },
  // Builders
  { name: "unified-props-engine", category: "Builders" },
  { name: "lottery-1500-builder", category: "Builders" },
  { name: "verify-unified-outcomes", category: "Builders" },
  { name: "verify-fanduel-trap-outcomes", category: "Builders" },
];

export const CRAWLER_JOB_NAMES = CRAWLER_JOBS.map((j) => j.name);

const CATEGORY_BY_JOB = new Map(CRAWLER_JOBS.map((j) => [j.name, j.category] as const));

export function getJobCategory(jobName: string): CrawlerCategory | "Other" {
  return CATEGORY_BY_JOB.get(jobName) ?? "Other";
}

const FETCH_COUNT_KEYS = [
  "markets",
  "marketsCount",
  "markets_count",
  "rowsFetched",
  "rows_fetched",
  "inserted",
  "updated",
  "propsCount",
  "props_count",
  "gamesProcessed",
  "games_processed",
  "totalFetched",
  "total_fetched",
  "count",
  "total",
];

export function extractFetchedCount(result: unknown): { key: string; value: number } | null {
  if (!result || typeof result !== "object") return null;
  const obj = result as Record<string, unknown>;
  for (const key of FETCH_COUNT_KEYS) {
    const v = obj[key];
    if (typeof v === "number" && Number.isFinite(v)) {
      return { key, value: v };
    }
  }
  return null;
}

export function formatJobLabel(name: string): string {
  return name.replace(/-/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
}

export const CRAWLER_CATEGORIES: CrawlerCategory[] = [
  "Scrapers",
  "Fetchers",
  "Injuries",
  "FanDuel",
  "Builders",
];