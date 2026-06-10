import type { PlayerState } from "../types";

export const STATE_COLOR: Record<PlayerState, string> = {
  neutral: "hsl(var(--term-muted))",
  over_pace: "hsl(var(--state-over))",
  under_pace: "hsl(var(--state-under))",
  usage_spike: "hsl(var(--state-usage))",
  sharp_action: "hsl(var(--state-sharp))",
  volatility: "hsl(var(--state-volatility))",
};

export const STATE_LABEL: Record<PlayerState, string> = {
  neutral: "Neutral",
  over_pace: "Over pace",
  under_pace: "Under pace",
  usage_spike: "Usage spike",
  sharp_action: "Sharp action",
  volatility: "Volatility",
};

export const STATE_PULSE: Record<PlayerState, boolean> = {
  neutral: false,
  over_pace: false,
  under_pace: false,
  usage_spike: true,
  sharp_action: true,
  volatility: false,
};