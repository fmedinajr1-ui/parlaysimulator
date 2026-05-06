// Nuke Parlay Scout Phase 2 — cross-sport roster lookup.
// Pulls rosters from ESPN's public site API and serves player→team lookups
// to the parlay builder. Tennis short-circuits (ESPN has no tennis rosters);
// the builder uses player_name from unified_props directly for tennis.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

export interface RosterEntry {
  sport: string;
  playerName: string;
  team: string;
  position?: string;
}

export interface RosterSource {
  fetchRosters(sport: string): Promise<RosterEntry[]>;
}

export interface RosterClientOptions {
  source?: RosterSource;
  cacheTtlMs?: number;
}

export function normalizeName(name: string): string {
  return (name ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[.,'`’\-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Internal sport → ESPN league/sport map.
const ESPN_SPORT_MAP: Record<string, { league: string; sport: string } | null> = {
  nba:    { league: "nba",                     sport: "basketball" },
  wnba:   { league: "wnba",                    sport: "basketball" },
  ncaab:  { league: "mens-college-basketball", sport: "basketball" },
  nfl:    { league: "nfl",                     sport: "football"   },
  ncaaf:  { league: "college-football",        sport: "football"   },
  nhl:    { league: "nhl",                     sport: "hockey"     },
  mlb:    { league: "mlb",                     sport: "baseball"   },
  tennis: null, // no ESPN roster equivalent
};

// Soccer is per-league; default curated set of leagues we care about.
const DEFAULT_SOCCER_LEAGUES = [
  "eng.1",  // EPL
  "esp.1",  // La Liga
  "ita.1",  // Serie A
  "ger.1",  // Bundesliga
  "fra.1",  // Ligue 1
  "uefa.champions",
  "uefa.europa",
  "usa.1",  // MLS
];

function soccerLeagues(): string[] {
  const env = (globalThis as any).Deno?.env?.get?.("NUKE_SOCCER_LEAGUES");
  if (!env) return DEFAULT_SOCCER_LEAGUES;
  return String(env)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export class EspnRosterSource implements RosterSource {
  async fetchRosters(sport: string): Promise<RosterEntry[]> {
    if (sport === "tennis") return [];
    if (sport === "soccer") {
      const leagues = soccerLeagues();
      const all: RosterEntry[] = [];
      for (const lg of leagues) {
        try {
          const rows = await this.fetchEspnLeague("soccer", lg, "soccer");
          all.push(...rows);
        } catch (e) {
          console.warn(`[rosters] soccer league ${lg} failed`, e);
        }
      }
      return all;
    }
    const map = ESPN_SPORT_MAP[sport];
    if (!map) return [];
    return await this.fetchEspnLeague(map.sport, map.league, sport);
  }

  private async fetchEspnLeague(espnSport: string, espnLeague: string, internalSport: string): Promise<RosterEntry[]> {
    const teamsUrl = `https://site.api.espn.com/apis/site/v2/sports/${espnSport}/${espnLeague}/teams`;
    const teamsRes = await fetch(teamsUrl);
    if (!teamsRes.ok) throw new Error(`ESPN teams ${espnLeague} ${teamsRes.status}`);
    const teamsJson: any = await teamsRes.json();
    const teamList: any[] = teamsJson?.sports?.[0]?.leagues?.[0]?.teams ?? [];
    const out: RosterEntry[] = [];
    for (const wrap of teamList) {
      const team = wrap?.team;
      if (!team?.id) continue;
      const teamName: string = team.displayName ?? team.name ?? "";
      try {
        const rosterUrl = `https://site.api.espn.com/apis/site/v2/sports/${espnSport}/${espnLeague}/teams/${team.id}/roster`;
        const r = await fetch(rosterUrl);
        if (!r.ok) {
          console.warn(`[rosters] ${espnLeague} team ${team.id} roster ${r.status}`);
          continue;
        }
        const j: any = await r.json();
        const ath = j?.athletes;
        if (!Array.isArray(ath)) continue;
        // Two shapes: flat array (NBA/NHL/MLB/soccer) or grouped by position with `items` (NFL).
        const flatten: any[] = [];
        for (const entry of ath) {
          if (entry?.items && Array.isArray(entry.items)) flatten.push(...entry.items);
          else flatten.push(entry);
        }
        for (const a of flatten) {
          const playerName: string = a?.fullName ?? a?.displayName ?? "";
          if (!playerName) continue;
          out.push({
            sport: internalSport === "soccer" ? "soccer" : internalSport,
            playerName,
            team: teamName,
            position: a?.position?.abbreviation ?? a?.position?.name ?? undefined,
          });
        }
      } catch (e) {
        console.warn(`[rosters] ${espnLeague} team ${team.id} fetch failed`, e);
      }
    }
    return out;
  }
}

interface CacheEntry { value: string | null; at: number }

export class RosterClient {
  private supabase: SupabaseClient;
  private source: RosterSource;
  private cacheTtlMs: number;
  private cache: Map<string, CacheEntry> = new Map();

  constructor(supabase: SupabaseClient, opts: RosterClientOptions = {}) {
    this.supabase = supabase;
    this.source = opts.source ?? new EspnRosterSource();
    this.cacheTtlMs = opts.cacheTtlMs ?? 24 * 60 * 60 * 1000;
  }

  clearCache() { this.cache.clear(); }

  async sync(sport: string): Promise<{ count: number }> {
    if (sport === "tennis") return { count: 0 }; // no-op
    const rows = await this.source.fetchRosters(sport);
    if (!rows.length) {
      throw new Error(`[rosters] sync ${sport} returned 0 rows; refusing to wipe table`);
    }
    try {
      const { error: delErr } = await this.supabase.from("rosters").delete().eq("sport", sport);
      if (delErr) throw delErr;
    } catch (e) {
      throw new Error(`[rosters] delete failed for ${sport}: ${String(e)}`);
    }
    const chunkSize = 500;
    let total = 0;
    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunk = rows.slice(i, i + chunkSize).map((r) => ({
        sport: r.sport,
        player_name: r.playerName,
        player_name_normalized: normalizeName(r.playerName),
        team: r.team,
        position: r.position ?? null,
        last_synced_at: new Date().toISOString(),
      }));
      try {
        const { error: iErr } = await this.supabase.from("rosters").insert(chunk);
        if (iErr) throw iErr;
        total += chunk.length;
      } catch (e) {
        console.error(`[rosters] insert chunk failed for ${sport}`, e);
      }
    }
    // clear cache for this sport
    for (const k of [...this.cache.keys()]) {
      if (k.startsWith(`${sport}|`)) this.cache.delete(k);
    }
    return { count: total };
  }

  async lookupTeam(sport: string, playerName: string, possibleTeams?: string[]): Promise<string | null> {
    const norm = normalizeName(playerName);
    const sortedTeams = (possibleTeams ?? []).slice().sort();
    const cacheKey = `${sport}|${norm}|${sortedTeams.join(",")}`;
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.at < this.cacheTtlMs) return cached.value;

    const looseMatch = (a: string, b: string) => {
      const A = a.toLowerCase();
      const B = b.toLowerCase();
      return A.includes(B) || B.includes(A);
    };

    let resolved: string | null = null;
    try {
      const { data, error } = await this.supabase
        .from("rosters")
        .select("team")
        .eq("sport", sport)
        .eq("player_name_normalized", norm);
      if (error) throw error;
      const rows = (data ?? []) as Array<{ team: string }>;

      if (rows.length === 1) {
        resolved = rows[0].team;
      } else if (rows.length > 1 && possibleTeams && possibleTeams.length) {
        const hit = rows.find((r) => possibleTeams.some((t) => looseMatch(r.team, t)));
        if (hit) resolved = hit.team;
      }

      if (!resolved && possibleTeams && possibleTeams.length) {
        const tokens = norm.split(" ").filter(Boolean);
        const lastName = tokens[tokens.length - 1] ?? "";
        if (lastName.length >= 3) {
          const { data: fuzzy, error: fErr } = await this.supabase
            .from("rosters")
            .select("team")
            .eq("sport", sport)
            .ilike("player_name_normalized", `%${lastName}`)
            .limit(20);
          if (fErr) throw fErr;
          const fuzzyRows = (fuzzy ?? []) as Array<{ team: string }>;
          const hit = fuzzyRows.find((r) => possibleTeams.some((t) => looseMatch(r.team, t)));
          if (hit) resolved = hit.team;
        }
      }
    } catch (e) {
      console.error(`[rosters] lookupTeam ${sport} ${playerName} failed`, e);
      resolved = null;
    }

    this.cache.set(cacheKey, { value: resolved, at: Date.now() });
    return resolved;
  }

  async lookupTeamsBatch(
    sport: string,
    players: Array<{ name: string; possibleTeams?: string[] }>
  ): Promise<Map<string, string | null>> {
    const out = new Map<string, string | null>();
    const results = await Promise.all(
      players.map((p) => this.lookupTeam(sport, p.name, p.possibleTeams).then((t) => [p.name, t] as const)),
    );
    for (const [name, team] of results) out.set(name, team);
    return out;
  }
}