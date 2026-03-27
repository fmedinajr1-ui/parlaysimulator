import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getEasternDate } from "@/lib/dateUtils";
import { useMemo } from "react";

export type DayType = "POINTS" | "THREES" | "REBOUNDS" | "ASSISTS" | "BALANCED";

export interface PropTypeSignal {
  propType: string;
  label: string;
  totalGamesWithSignal: number;
  avgMatchupScore: number;
  maxMatchupScore: number;
  totalAttackVectors: number;
  strength: "ELITE" | "STRONG" | "MODERATE" | "WEAK";
  emoji: string;
}

export interface DayClassification {
  primary: DayType;
  secondary: DayType | null;
  signals: PropTypeSignal[];
  confidence: number;
  summary: string;
  gameBreakdown: { gameKey: string; topProp: string; score: number }[];
}

const PROP_META: Record<string, { label: string; emoji: string; dayType: DayType }> = {
  points: { label: "Points", emoji: "🔥", dayType: "POINTS" },
  threes: { label: "Threes", emoji: "🎯", dayType: "THREES" },
  rebounds: { label: "Rebounds", emoji: "💪", dayType: "REBOUNDS" },
  assists: { label: "Assists", emoji: "🅰️", dayType: "ASSISTS" },
};

function parseMatchupScan(summary: string): PropTypeSignal[] {
  const propScores: Record<string, { scores: number[]; vectors: number; games: Set<string> }> = {
    points: { scores: [], vectors: 0, games: new Set() },
    threes: { scores: [], vectors: 0, games: new Set() },
    rebounds: { scores: [], vectors: 0, games: new Set() },
    assists: { scores: [], vectors: 0, games: new Set() },
  };

  // Parse format: "LAC@IND: AwayAttacks=[threes(OFF16vDEF15=15),...] HomeAttacks=[...]"
  const gameBlocks = summary.split(" | ");
  for (const block of gameBlocks) {
    const gameKeyMatch = block.match(/^([A-Z]+@[A-Z]+)/);
    const gameKey = gameKeyMatch?.[1] || "UNK";

    // Extract all prop(OFFxvDEFy=score) patterns
    const propPattern = /(points|threes|rebounds|assists)\(OFF\d+vDEF\d+=([0-9.]+)\)/g;
    let match;
    while ((match = propPattern.exec(block)) !== null) {
      const propType = match[1];
      const score = parseFloat(match[2]);
      if (propScores[propType]) {
        propScores[propType].scores.push(score);
        propScores[propType].vectors++;
        propScores[propType].games.add(gameKey);
      }
    }
  }

  return Object.entries(propScores)
    .map(([key, data]) => {
      const avg = data.scores.length > 0
        ? data.scores.reduce((a, b) => a + b, 0) / data.scores.length
        : 0;
      const max = data.scores.length > 0 ? Math.max(...data.scores) : 0;

      let strength: PropTypeSignal["strength"] = "WEAK";
      if (avg >= 22 && data.vectors >= 6) strength = "ELITE";
      else if (avg >= 18 && data.vectors >= 4) strength = "STRONG";
      else if (avg >= 15 && data.vectors >= 2) strength = "MODERATE";

      const meta = PROP_META[key];
      return {
        propType: key,
        label: meta.label,
        totalGamesWithSignal: data.games.size,
        avgMatchupScore: Math.round(avg * 10) / 10,
        maxMatchupScore: Math.round(max * 10) / 10,
        totalAttackVectors: data.vectors,
        strength,
        emoji: meta.emoji,
      };
    })
    .sort((a, b) => b.avgMatchupScore - a.avgMatchupScore);
}

function buildGameBreakdown(summary: string): DayClassification["gameBreakdown"] {
  const games: DayClassification["gameBreakdown"] = [];
  const gameBlocks = summary.split(" | ");

  for (const block of gameBlocks) {
    const gameKeyMatch = block.match(/^([A-Z]+@[A-Z]+)/);
    if (!gameKeyMatch) continue;
    const gameKey = gameKeyMatch[1];

    const propPattern = /(points|threes|rebounds|assists)\(OFF\d+vDEF\d+=([0-9.]+)\)/g;
    let bestProp = "";
    let bestScore = 0;
    let match;
    while ((match = propPattern.exec(block)) !== null) {
      const score = parseFloat(match[2]);
      if (score > bestScore) {
        bestScore = score;
        bestProp = match[1];
      }
    }
    if (bestProp) {
      games.push({ gameKey, topProp: bestProp, score: bestScore });
    }
  }

  return games.sort((a, b) => b.score - a.score);
}

function classify(signals: PropTypeSignal[], gameBreakdown: DayClassification["gameBreakdown"]): DayClassification {
  const top = signals[0];
  const second = signals[1];

  const primaryType = PROP_META[top?.propType]?.dayType || "BALANCED";

  let secondaryType: DayType | null = null;
  if (second && second.avgMatchupScore >= 15 && second.totalAttackVectors >= 3) {
    secondaryType = PROP_META[second.propType]?.dayType || null;
  }

  // If top two are very close, it's balanced
  const isBalanced = top && second &&
    Math.abs(top.avgMatchupScore - second.avgMatchupScore) < 2 &&
    top.totalAttackVectors === second.totalAttackVectors;

  const primary = isBalanced ? "BALANCED" : primaryType;

  // Confidence: based on signal strength gap and vector count
  const gap = top && second ? top.avgMatchupScore - second.avgMatchupScore : top?.avgMatchupScore || 0;
  const confidence = Math.min(95, Math.round(50 + gap * 2 + (top?.totalAttackVectors || 0) * 2));

  const eliteGames = gameBreakdown.filter(g => g.score >= 25);
  const strongGames = gameBreakdown.filter(g => g.score >= 20);

  let summary = "";
  if (primary === "BALANCED") {
    summary = `Balanced slate — ${top.label} and ${second?.label} matchups equally strong across ${gameBreakdown.length} games`;
  } else {
    summary = `${PROP_META[top.propType]?.emoji} ${top.label} day — ${top.totalAttackVectors} attack vectors across ${top.totalGamesWithSignal} games (avg score ${top.avgMatchupScore})`;
    if (eliteGames.length > 0) {
      summary += `. ${eliteGames.length} elite matchup${eliteGames.length > 1 ? "s" : ""} (${eliteGames.map(g => g.gameKey).join(", ")})`;
    }
  }

  return {
    primary,
    secondary: isBalanced ? null : secondaryType,
    signals,
    confidence,
    summary,
    gameBreakdown,
  };
}

export function useDayTypeClassifier() {
  const today = getEasternDate();

  const { data: matchupScan, isLoading } = useQuery({
    queryKey: ["day-type-classifier", today],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bot_research_findings")
        .select("summary")
        .eq("research_date", today)
        .eq("category", "matchup_defense_scan")
        .order("relevance_score", { ascending: false })
        .limit(1);

      if (error) throw error;
      return data?.[0]?.summary || null;
    },
    staleTime: 300_000,
  });

  const classification = useMemo<DayClassification | null>(() => {
    if (!matchupScan) return null;

    const signals = parseMatchupScan(matchupScan);
    const gameBreakdown = buildGameBreakdown(matchupScan);
    return classify(signals, gameBreakdown);
  }, [matchupScan]);

  return {
    classification,
    isLoading,
    today,
  };
}
