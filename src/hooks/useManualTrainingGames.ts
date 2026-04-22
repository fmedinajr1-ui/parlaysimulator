import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getEasternDate } from "@/lib/dateUtils";

const STALE_THRESHOLD_MINUTES = 120;

type TrainingGameRow = {
  event_id: string | null;
  sport: string | null;
  game_description: string | null;
  commence_time: string | null;
  bookmaker: string | null;
  odds_updated_at: string | null;
  updated_at: string | null;
  is_active: boolean | null;
};

export interface ManualTrainingGame {
  eventId: string;
  sport: string;
  gameDescription: string;
  homeTeam: string;
  awayTeam: string;
  commenceTime: string;
  propRows: number;
  activePropRows: number;
  bookmakerCount: number;
  bookmakers: string[];
  freshRowCount: number;
  staleRowCount: number;
  latestUpdateAt: string | null;
  hasFanDuel: boolean;
}

function getQueryWindowForEasternDate(easternDate: string) {
  const nextDay = new Date(`${easternDate}T00:00:00Z`);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  const nextDayString = nextDay.toISOString().slice(0, 10);

  return {
    startUTC: `${easternDate}T00:00:00Z`,
    endUTC: `${nextDayString}T12:00:00Z`,
  };
}

function getEasternDateKey(dateString: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(dateString));
}

function splitGameDescription(gameDescription: string) {
  const parts = gameDescription.split(" @ ");
  return {
    awayTeam: parts[0] || "Unknown",
    homeTeam: parts[1] || "Unknown",
  };
}

export function useManualTrainingGames(targetDate = getEasternDate()) {
  const [sportFilter, setSportFilter] = useState<string>("all");
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);

  const { startUTC, endUTC } = getQueryWindowForEasternDate(targetDate);

  const query = useQuery({
    queryKey: ["manual-training-games", targetDate],
    queryFn: async (): Promise<ManualTrainingGame[]> => {
      const { data, error } = await supabase
        .from("unified_props")
        .select(
          "event_id, sport, game_description, commence_time, bookmaker, odds_updated_at, updated_at, is_active"
        )
        .gte("commence_time", startUTC)
        .lt("commence_time", endUTC)
        .order("commence_time", { ascending: true });

      if (error) throw error;

      const rows = (data || []).filter((row): row is TrainingGameRow => {
        return Boolean(row.game_description && row.commence_time && row.sport);
      });

      const todaysRows = rows.filter((row) => getEasternDateKey(row.commence_time as string) === targetDate);
      const now = Date.now();
      const games = new Map<string, ManualTrainingGame>();

      for (const row of todaysRows) {
        const gameDescription = row.game_description as string;
        const commenceTime = row.commence_time as string;
        const sport = row.sport as string;
        const eventId = row.event_id || `${sport}:${gameDescription}`;
        const key = eventId;
        const updateAt = row.odds_updated_at || row.updated_at;
        const ageMinutes = updateAt ? (now - new Date(updateAt).getTime()) / 60000 : Number.POSITIVE_INFINITY;
        const { homeTeam, awayTeam } = splitGameDescription(gameDescription);

        if (!games.has(key)) {
          games.set(key, {
            eventId,
            sport,
            gameDescription,
            homeTeam,
            awayTeam,
            commenceTime,
            propRows: 0,
            activePropRows: 0,
            bookmakerCount: 0,
            bookmakers: [],
            freshRowCount: 0,
            staleRowCount: 0,
            latestUpdateAt: null,
            hasFanDuel: false,
          });
        }

        const game = games.get(key)!;
        game.propRows += 1;
        if (row.is_active !== false) {
          game.activePropRows += 1;
        }
        if (row.bookmaker && !game.bookmakers.includes(row.bookmaker)) {
          game.bookmakers.push(row.bookmaker);
          game.bookmakerCount = game.bookmakers.length;
        }
        if ((row.bookmaker || "").toLowerCase() === "fanduel") {
          game.hasFanDuel = true;
        }
        if (ageMinutes <= STALE_THRESHOLD_MINUTES) {
          game.freshRowCount += 1;
        } else {
          game.staleRowCount += 1;
        }
        if (!game.latestUpdateAt || (updateAt && new Date(updateAt).getTime() > new Date(game.latestUpdateAt).getTime())) {
          game.latestUpdateAt = updateAt;
        }
      }

      return Array.from(games.values()).sort(
        (a, b) => new Date(a.commenceTime).getTime() - new Date(b.commenceTime).getTime()
      );
    },
  });

  const sportOptions = useMemo(() => {
    const options = Array.from(new Set((query.data || []).map((game) => game.sport))).sort();
    return ["all", ...options];
  }, [query.data]);

  const games = useMemo(() => {
    if (sportFilter === "all") return query.data || [];
    return (query.data || []).filter((game) => game.sport === sportFilter);
  }, [query.data, sportFilter]);

  useEffect(() => {
    if (!games.length) {
      if (selectedEventId !== null) setSelectedEventId(null);
      return;
    }

    const selectionStillExists = selectedEventId && games.some((game) => game.eventId === selectedEventId);
    if (!selectionStillExists) {
      setSelectedEventId(games[0].eventId);
    }
  }, [games, selectedEventId]);

  const selectedGame = useMemo(
    () => games.find((game) => game.eventId === selectedEventId) ?? null,
    [games, selectedEventId]
  );

  return {
    date: targetDate,
    games,
    allGames: query.data || [],
    selectedGame,
    selectedEventId,
    setSelectedEventId,
    sportFilter,
    setSportFilter,
    sportOptions,
    isLoading: query.isLoading,
    isRefetching: query.isRefetching,
    error: query.error,
    refetch: query.refetch,
  };
}