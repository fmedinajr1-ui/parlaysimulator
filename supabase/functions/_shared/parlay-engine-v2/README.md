# ParlayIQ Bot Generator

Drop-in Supabase Edge Function engine for Lovable.

## Functions

- `cross-sport-sweet-spots`: scores individual legs into `lock`, `strong`, `lean`, and `drop`.
- `cross-sport-parlay-generator`: builds ranked 2-leg, 3-leg, 4-leg, and 5-leg tickets with hard gates, correlation, EV, and stake sizing.

## Request

```json
{
  "stake": 5,
  "maxTickets": 25,
  "bankroll": {
    "enabled": true,
    "bankroll": 100,
    "hits": 4,
    "n": 8,
    "rollingEvPerUnit": 0.1
  },
  "pairLifts": [
    { "a": "leg-1", "b": "leg-2", "lift": 1.04 }
  ],
  "legs": [
    {
      "id": "leg-1",
      "sport": "NBA",
      "gameId": "game-a",
      "player": "Player Name",
      "prop": "points",
      "side": "over",
      "decimalOdds": 1.91,
      "confidence": 0.76,
      "signalTier": "S",
      "l10HitRate": 0.8,
      "l10Games": 10,
      "floorMargin": 0.75,
      "medianMargin": 0.7,
      "modelP": 0.7,
      "research": { "boost": 0.04 }
    }
  ]
}
```

`stake` is the base unit. The engine scales it by ticket tier and average confidence unless bankroll mode supplies a Kelly stake.

## Lovable Client Call

```ts
const { data, error } = await supabase.functions.invoke("cross-sport-parlay-generator", {
  body: {
    stake: 5,
    maxTickets: 25,
    legs,
    pairLifts,
    bankroll,
  },
});
```

## Output

The generator returns:

- `legs`: every input leg with `legQuality`, `safety`, `safetyTier`, odds, and reasons.
- `tickets`: ranked parlays with `prob`, `correlatedProb`, `decimalOdds`, `americanOdds`, `ev`, `parlayEdge`, `parlayScore`, `stake`, and `rankingScore`.
- `dropped`: legs removed by hard gates.
