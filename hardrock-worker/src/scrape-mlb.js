// Hard Rock Bet MLB moneyline scraper (Kambi-style JSON endpoint).
import { fetchJson, decimalToAmerican } from "./browser.js";

const HR_MLB_URL =
  "https://eu-offering-api.kambicdn.com/offering/v2018/hrcza/listView/baseball/mlb.json?lang=en_US&market=US&includeParticipants=true";

export async function scrapeMlbMoneylines() {
  let json;
  try {
    json = await fetchJson(HR_MLB_URL);
  } catch (e) {
    if (String(e.message).startsWith("hr_auth_")) {
      json = await fetchJson(HR_MLB_URL); // retry once after session reset
    } else throw e;
  }

  const out = [];
  for (const wrap of json?.events ?? []) {
    const event = wrap.event;
    const offers = wrap.betOffers ?? [];
    if (!event || !offers.length) continue;
    const ml = offers.find((o) =>
      Array.isArray(o.outcomes) &&
      o.outcomes.length === 2 &&
      o.outcomes.every((x) => x.type === "OT_ONE" || x.type === "OT_TWO") &&
      (o.criterion?.label?.toLowerCase().includes("money") ||
        o.betOfferType?.englishName?.toLowerCase().includes("match"))
    );
    if (!ml) continue;

    const { homeName, awayName } = event;
    if (!homeName || !awayName) continue;
    const homeOut = ml.outcomes.find((o) => o.participant === homeName);
    const awayOut = ml.outcomes.find((o) => o.participant === awayName);
    if (!homeOut || !awayOut) continue;

    const home_price = decimalToAmerican(homeOut.odds / 1000);
    const away_price = decimalToAmerican(awayOut.odds / 1000);
    if (home_price == null || away_price == null) continue;

    out.push({
      event_id: String(event.id),
      start_time: event.start,
      home_team: homeName,
      away_team: awayName,
      home_price,
      away_price,
      captured_at: new Date().toISOString(),
    });
  }
  return out;
}