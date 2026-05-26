// Telegram alert formatter for Scout Speed Edge.
// Uses full property labels per core memory rule (no abbreviations).

const MARKET_LABELS: Record<string, string> = {
  player_ast: "Assists",
  player_pra: "Points + Rebounds + Assists",
  player_pts: "Points",
  player_reb: "Rebounds",
  live_spread: "Live Spread",
  live_total: "Live Total",
  team_score: "Team Score",
};

export function marketLabel(marketType: string): string {
  return MARKET_LABELS[marketType] ?? marketType;
}

export interface EdgeForFormat {
  player_name: string | null;
  edge_type: string;
  market_delay_seconds: number;
  excess_lag_seconds: number;
  confidence: number;
  expected_move: number;
  model_edge: number;
  stake_units: number;
  expires_at: string;
}

export interface MarketForFormat {
  sportsbook: string;
  line: number | null;
}

export function tierFor(modelEdge: number): string {
  if (modelEdge >= 0.10) return "🔥 FIRE";
  if (modelEdge >= 0.06) return "⚡ STRONG";
  return "👀 WATCH";
}

export function formatSpeedEdgeAlert(
  edge: EdgeForFormat,
  eventType: string,
  market: MarketForFormat,
): string {
  const tier = tierFor(edge.model_edge);
  const windowSec = Math.max(0, Math.floor((Date.parse(edge.expires_at) - Date.now()) / 1000));
  const direction = edge.expected_move > 0 ? "OVER" : "UNDER";
  const lineStr = market.line != null ? String(market.line) : "";

  return [
    `🚨 *SPEED EDGE — ${tier}*`,
    ``,
    `Player: ${edge.player_name ?? "—"}`,
    `Market: ${marketLabel(edge.edge_type)} ${lineStr}`.trim(),
    `Book: ${market.sportsbook}`,
    `Trigger: ${eventType}`,
    ``,
    `Lag: ${Number(edge.market_delay_seconds).toFixed(1)}s (excess ${Number(edge.excess_lag_seconds).toFixed(1)}s)`,
    `Confidence: ${(edge.confidence * 100).toFixed(0)}%`,
    `Expected move: ${Number(edge.expected_move).toFixed(2)}`,
    `EV: ${(edge.model_edge * 100).toFixed(1)}%`,
    `Stake: ${(edge.stake_units * 100).toFixed(1)}% unit (½-Kelly)`,
    ``,
    `Window: ${windowSec}s remaining`,
    `Action: ${direction} ${lineStr}`.trim(),
  ].join("\n");
}