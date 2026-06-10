export type PlayerState =
  | "neutral"
  | "over_pace"
  | "under_pace"
  | "usage_spike"
  | "sharp_action"
  | "volatility";

export type Side = "home" | "away";

export type TerminalPlayer = {
  id: string;
  side: Side;
  name: string;
  initials: string;
  number: number;
  position: string;
  /** Normalized 0..1 within pitch SVG viewBox */
  x: number;
  y: number;
  /** Last few positions (newest last), normalized */
  trail: Array<{ x: number; y: number }>;
  /** Predicted next position, normalized */
  ghost?: { x: number; y: number };
  state: PlayerState;
  isBallCarrier?: boolean;
  /** Optional headshot url; fallback to initials */
  headshot?: string;
  teamColor: string;
  /** Edge details for tooltip + edge panel */
  edge?: {
    propType: string;
    line: number;
    projection: number;
    edgePct: number; // signed
    book?: string;
  };
  involvementPct?: number;
};

export type NextPlay = {
  label: string;
  probability: number; // 0..1
};

export type Trajectory = {
  from: { x: number; y: number };
  to: { x: number; y: number };
  kind: "shot" | "route" | "pass";
  color?: string;
};