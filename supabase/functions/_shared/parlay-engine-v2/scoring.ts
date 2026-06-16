import { NBA_PROP_WHITELIST, SIGNAL_TIER_MULT, THIN_SAMPLE_GAMES } from "./config.ts";
import type { LegInput, SafetyTier, ScoredLeg } from "./models.ts";

export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

export function americanToDecimal(americanOdds: number): number {
  if (americanOdds === 0 || !Number.isFinite(americanOdds)) return 1;
  return americanOdds > 0 ? 1 + americanOdds / 100 : 1 + 100 / Math.abs(americanOdds);
}

export function decimalToAmerican(decimalOdds: number): number {
  if (decimalOdds < 1.01 || !Number.isFinite(decimalOdds)) return -10000;
  return decimalOdds >= 2
    ? Math.round((decimalOdds - 1) * 100)
    : Math.round(-100 / (decimalOdds - 1));
}

export function impliedProbability(decimalOdds: number): number {
  return decimalOdds > 1 ? 1 / decimalOdds : 1;
}

function normalizeDecimalOdds(leg: LegInput): number {
  if (leg.decimalOdds && leg.decimalOdds > 1) return leg.decimalOdds;
  if (leg.americanOdds) return americanToDecimal(leg.americanOdds);
  return 1.91;
}

function whitelistMult(leg: LegInput): number {
  if (leg.sport !== "NBA") return 1;
  const key = `${(leg.prop ?? "").toLowerCase()}:${(leg.side ?? "").toLowerCase()}`;
  return 0.70 + 0.50 * (NBA_PROP_WHITELIST[key] ?? 0);
}

export function legQuality(leg: LegInput): number {
  const confidence = clamp01(leg.confidence);
  const verifierMult = clamp(leg.verifierMult ?? 1.0, 0.3, 1.2);
  const signalTierMult = SIGNAL_TIER_MULT[leg.signalTier ?? "Unknown"];
  const edgeBonus = (leg.edge ?? 0) > 0 ? 1 + Math.min(0.05, (leg.edge ?? 0) * 0.01) : 1;
  return confidence * verifierMult * signalTierMult * whitelistMult(leg) * edgeBonus;
}

function tierFromSafety(safety: number): SafetyTier {
  if (safety >= 0.80) return "lock";
  if (safety >= 0.70) return "strong";
  if (safety >= 0.60) return "lean";
  return "drop";
}

export function playerLegSafety(leg: LegInput, implied: number): { safety: number; tier: SafetyTier; reasons: string[] } {
  const reasons: string[] = [];
  const modelP = clamp01(leg.modelP ?? leg.confidence);
  const edgeComponent = clamp01(modelP - implied + 0.5);
  const researchBoost = clamp(leg.research?.boost ?? 0, -0.10, 0.10);
  const safety = clamp01(
    0.45 * clamp01(leg.l10HitRate ?? leg.confidence) +
      0.20 * clamp01(leg.floorMargin ?? 0.5) +
      0.15 * clamp01(leg.medianMargin ?? 0.5) +
      0.10 * edgeComponent +
      0.10 * clamp01(0.5 + researchBoost * 5),
  );

  let tier = tierFromSafety(safety);
  if ((leg.l10Games ?? 10) < THIN_SAMPLE_GAMES && tier !== "drop") {
    tier = "lean";
    reasons.push("thin_sample_cap");
  }

  return { safety, tier, reasons };
}

export function teamLegSafety(leg: LegInput, implied: number): { safety: number; tier: SafetyTier; reasons: string[] } {
  const reasons: string[] = [];
  if (Math.abs(leg.spread ?? 0) >= 9.5) reasons.push("drop_wide_spread");
  if ((leg.americanOdds ?? decimalToAmerican(normalizeDecimalOdds(leg))) < -250) reasons.push("drop_price_worse_than_minus_250");

  const side = (leg.side ?? "").toLowerCase();
  const structuralBump = leg.structuralBump ??
    (leg.isHome && side === "ml" ? 0.04 :
      leg.isHome && side === "spread" ? 0.03 :
        side === "under" || side === "total" ? 0.02 : 0.01);
  const conf = Math.min(0.85, implied + structuralBump);
  const researchBoost = clamp(leg.research?.boost ?? 0, -0.10, 0.10);
  const safety = clamp01(0.95 * conf + 0.05 + 0.10 * Math.max(0, conf - 0.50) + 0.25 * researchBoost);
  const tier = reasons.some((reason) => reason.startsWith("drop_")) ? "drop" : tierFromSafety(safety);
  return { safety, tier, reasons };
}

export function scoreLeg(leg: LegInput): ScoredLeg {
  const decimalOdds = normalizeDecimalOdds(leg);
  const americanOdds = leg.americanOdds ?? decimalToAmerican(decimalOdds);
  const impliedProb = leg.impliedProb ?? impliedProbability(decimalOdds);
  const kind = leg.kind ?? (leg.player ? "player" : "team");
  const safetyResult = kind === "team" ? teamLegSafety(leg, impliedProb) : playerLegSafety(leg, impliedProb);

  return {
    ...leg,
    decimalOdds,
    americanOdds,
    impliedProb,
    kind,
    signalTier: leg.signalTier ?? "Unknown",
    verifierMult: clamp(leg.verifierMult ?? 1, 0.3, 1.2),
    edge: leg.edge ?? 0,
    legQuality: legQuality(leg),
    safety: safetyResult.safety,
    safetyTier: safetyResult.tier,
    reasons: safetyResult.reasons,
  };
}

export function geomean(values: number[]): number {
  if (!values.length) return 0;
  return Math.exp(values.reduce((sum, value) => sum + Math.log(Math.max(value, 0.0001)), 0) / values.length);
}
