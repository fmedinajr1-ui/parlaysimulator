// Hard Rock Bet NBA player-prop scraper.
//
// HR exposes prop markets per-event via the Kambi betOffers endpoint. We
// first list NBA events, then fan out to each event's offers. Returns
// normalized player props (points, rebounds, assists, threes, PRA, steals,
// blocks). Two-sided where HR posts both Over and Under.

import { fetchJson, decimalToAmerican } from "./browser.js";

const HR_NBA_LIST =
  "https://eu-offering-api.kambicdn.com/offering/v2018/hrcza/listView/basketball/nba.json?lang=en_US&market=US&includeParticipants=true";
const HR_EVENT_OFFERS = (eventId) =>
  `https://eu-offering-api.kambicdn.com/offering/v2018/hrcza/betoffer/event/${eventId}.json?lang=en_US&market=US&includeParticipants=true`;

// Kambi criterion labels → our prop_type taxonomy (matches NBA hardrock-lines.ts).
const PROP_LABEL_MAP = [
  { match: /total\s*points/i, type: "player_points" },
  { match: /total\s*rebounds/i, type: "player_rebounds" },
  { match: /total\s*assists/i, type: "player_assists" },
  { match: /three\s*point|3-?point/i, type: "player_threes" },
  { match: /pts\s*\+\s*reb\s*\+\s*ast|points\s*\+\s*rebounds\s*\+\s*assists/i, type: "player_points_rebounds_assists" },
  { match: /steals/i, type: "player_steals" },
  { match: /blocks/i, type: "player_blocks" },
];

function classifyProp(label) {
  for (const { match, type } of PROP_LABEL_MAP) if (match.test(label)) return type;
  return null;
}

export async function scrapeNbaPlayerProps({ maxEvents = 20 } = {}) {
  let listJson;
  try {
    listJson = await fetchJson(HR_NBA_LIST);
  } catch (e) {
    if (String(e.message).startsWith("hr_auth_")) listJson = await fetchJson(HR_NBA_LIST);
    else throw e;
  }

  const events = (listJson?.events ?? []).slice(0, maxEvents);
  const out = [];

  for (const wrap of events) {
    const event = wrap.event;
    if (!event?.id) continue;
    let offersJson;
    try {
      offersJson = await fetchJson(HR_EVENT_OFFERS(event.id), { timeout: 12000 });
    } catch (e) {
      console.warn(`[hr-nba] event ${event.id} offers failed:`, e.message);
      continue;
    }

    for (const offer of offersJson?.betOffers ?? []) {
      const label = offer?.criterion?.label ?? "";
      const prop_type = classifyProp(label);
      if (!prop_type) continue;

      // Group outcomes per (player, line) so we capture Over/Under pairs.
      const grouped = new Map();
      for (const o of offer.outcomes ?? []) {
        const player = o.participant ?? o.englishLabel ?? "";
        const line = typeof o.line === "number" ? o.line / 1000 : Number(o.line);
        if (!player || !Number.isFinite(line)) continue;
        const key = `${player.toLowerCase()}|${line}`;
        const cur = grouped.get(key) ?? { player, line, over: null, under: null };
        const side = String(o.label ?? o.type ?? "").toLowerCase();
        const american = decimalToAmerican(o.odds / 1000);
        if (side.includes("over") || o.type === "OT_OVER") cur.over = american;
        else if (side.includes("under") || o.type === "OT_UNDER") cur.under = american;
        grouped.set(key, cur);
      }

      for (const v of grouped.values()) {
        out.push({
          event_id: String(event.id),
          home_team: event.homeName,
          away_team: event.awayName,
          player: v.player,
          prop_type,
          line: v.line,
          over_price: v.over,
          under_price: v.under,
          captured_at: new Date().toISOString(),
        });
      }
    }
  }
  return out;
}