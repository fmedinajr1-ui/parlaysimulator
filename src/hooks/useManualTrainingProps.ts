import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

const STALE_THRESHOLD_MINUTES = 120;

type TrainingPropRow = {
  event_id: string | null;
  game_description: string | null;
  commence_time: string | null;
  player_name: string | null;
  prop_type: string | null;
  current_line: number | null;
  bookmaker: string | null;
  is_active: boolean | null;
  odds_updated_at: string | null;
  updated_at: string | null;
  over_price: number | null;
  under_price: number | null;
};

export interface ManualTrainingPropOption {
  key: string;
  playerName: string;
  propType: string;
  currentLine: number | null;
  rowCount: number;
  bookmakerCount: number;
  bookmakers: string[];
  activeRowCount: number;
  freshRowCount: number;
  latestUpdateAt: string | null;
  hasFanDuel: boolean;
  overPrice: number | null;
  underPrice: number | null;
}

export interface ManualTrainingPlayer {
  name: string;
  propCount: number;
  activePropCount: number;
  freshPropCount: number;
  bookmakers: string[];
  hasFanDuel: boolean;
  props: ManualTrainingPropOption[];
}

interface ManualTrainingPropsParams {
  eventId?: string | null;
  gameDescription?: string | null;
  commenceTime?: string | null;
}

function formatPropType(propType: string) {
  return propType
    .replace(/^player_/i, "")
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function normalizeKeyPart(value: string | number | null) {
  if (value === null || value === undefined) return "na";
  return String(value).trim().toLowerCase();
}

export function useManualTrainingProps({
  eventId,
  gameDescription,
  commenceTime,
}: ManualTrainingPropsParams) {
  const [selectedPlayerName, setSelectedPlayerName] = useState<string | null>(null);
  const [selectedPropKeys, setSelectedPropKeys] = useState<string[]>([]);

  const query = useQuery({
    queryKey: ["manual-training-props", eventId, gameDescription, commenceTime],
    enabled: Boolean(eventId || gameDescription),
    queryFn: async (): Promise<ManualTrainingPlayer[]> => {
      let rows: TrainingPropRow[] = [];

      if (eventId) {
        const { data, error } = await supabase
          .from("unified_props")
          .select(
            "event_id, game_description, commence_time, player_name, prop_type, current_line, bookmaker, is_active, odds_updated_at, updated_at, over_price, under_price"
          )
          .eq("event_id", eventId)
          .not("player_name", "is", null)
          .not("prop_type", "is", null)
          .order("player_name", { ascending: true });

        if (error) throw error;
        rows = (data || []) as TrainingPropRow[];
      }

      if (!rows.length && gameDescription) {
        let fallbackQuery = supabase
          .from("unified_props")
          .select(
            "event_id, game_description, commence_time, player_name, prop_type, current_line, bookmaker, is_active, odds_updated_at, updated_at, over_price, under_price"
          )
          .eq("game_description", gameDescription)
          .not("player_name", "is", null)
          .not("prop_type", "is", null)
          .order("player_name", { ascending: true });

        if (commenceTime) {
          fallbackQuery = fallbackQuery.eq("commence_time", commenceTime);
        }

        const { data, error } = await fallbackQuery;
        if (error) throw error;
        rows = (data || []) as TrainingPropRow[];
      }

      const now = Date.now();
      const playerMap = new Map<string, { props: Map<string, ManualTrainingPropOption> } & Omit<ManualTrainingPlayer, "props">>();

      for (const row of rows) {
        const playerName = row.player_name?.trim();
        const propType = row.prop_type?.trim();

        if (!playerName || !propType) continue;

        const playerKey = playerName.toLowerCase();
        const propKey = `${normalizeKeyPart(playerName)}::${normalizeKeyPart(propType)}::${normalizeKeyPart(row.current_line)}`;
        const updateAt = row.odds_updated_at || row.updated_at;
        const ageMinutes = updateAt ? (now - new Date(updateAt).getTime()) / 60000 : Number.POSITIVE_INFINITY;

        if (!playerMap.has(playerKey)) {
          playerMap.set(playerKey, {
            name: playerName,
            propCount: 0,
            activePropCount: 0,
            freshPropCount: 0,
            bookmakers: [],
            hasFanDuel: false,
            props: new Map<string, ManualTrainingPropOption>(),
          });
        }

        const player = playerMap.get(playerKey)!;

        if (!player.props.has(propKey)) {
          player.props.set(propKey, {
            key: propKey,
            playerName,
            propType,
            currentLine: row.current_line,
            rowCount: 0,
            bookmakerCount: 0,
            bookmakers: [],
            activeRowCount: 0,
            freshRowCount: 0,
            latestUpdateAt: null,
            hasFanDuel: false,
            overPrice: row.over_price,
            underPrice: row.under_price,
          });
        }

        const prop = player.props.get(propKey)!;
        prop.rowCount += 1;

        if (row.is_active !== false) {
          prop.activeRowCount += 1;
        }
        if (ageMinutes <= STALE_THRESHOLD_MINUTES) {
          prop.freshRowCount += 1;
        }
        if (row.bookmaker && !prop.bookmakers.includes(row.bookmaker)) {
          prop.bookmakers.push(row.bookmaker);
          prop.bookmakerCount = prop.bookmakers.length;
        }
        if ((row.bookmaker || "").toLowerCase() === "fanduel") {
          prop.hasFanDuel = true;
        }
        if (!prop.latestUpdateAt || (updateAt && new Date(updateAt).getTime() > new Date(prop.latestUpdateAt).getTime())) {
          prop.latestUpdateAt = updateAt;
        }
        if (prop.overPrice === null && row.over_price !== null) {
          prop.overPrice = row.over_price;
        }
        if (prop.underPrice === null && row.under_price !== null) {
          prop.underPrice = row.under_price;
        }

        if (row.bookmaker && !player.bookmakers.includes(row.bookmaker)) {
          player.bookmakers.push(row.bookmaker);
        }
        if ((row.bookmaker || "").toLowerCase() === "fanduel") {
          player.hasFanDuel = true;
        }
      }

      return Array.from(playerMap.values())
        .map((player) => {
          const props = Array.from(player.props.values()).sort((a, b) => {
            const propTypeCompare = formatPropType(a.propType).localeCompare(formatPropType(b.propType));
            if (propTypeCompare !== 0) return propTypeCompare;
            return (a.currentLine ?? 0) - (b.currentLine ?? 0);
          });

          return {
            name: player.name,
            propCount: props.length,
            activePropCount: props.filter((prop) => prop.activeRowCount > 0).length,
            freshPropCount: props.filter((prop) => prop.freshRowCount > 0).length,
            bookmakers: player.bookmakers.sort(),
            hasFanDuel: player.hasFanDuel,
            props,
          };
        })
        .sort((a, b) => {
          if (b.propCount !== a.propCount) return b.propCount - a.propCount;
          return a.name.localeCompare(b.name);
        });
    },
  });

  useEffect(() => {
    setSelectedPlayerName(null);
    setSelectedPropKeys([]);
  }, [eventId, gameDescription, commenceTime]);

  const players = query.data || [];

  useEffect(() => {
    if (!players.length) {
      if (selectedPlayerName !== null) setSelectedPlayerName(null);
      if (selectedPropKeys.length) setSelectedPropKeys([]);
      return;
    }

    const selectionStillExists = selectedPlayerName && players.some((player) => player.name === selectedPlayerName);
    if (!selectionStillExists) {
      setSelectedPlayerName(players[0].name);
    }
  }, [players, selectedPlayerName, selectedPropKeys.length]);

  const selectedPlayer = useMemo(
    () => players.find((player) => player.name === selectedPlayerName) ?? null,
    [players, selectedPlayerName]
  );

  useEffect(() => {
    if (!selectedPlayer) {
      if (selectedPropKeys.length) setSelectedPropKeys([]);
      return;
    }

    setSelectedPropKeys((current) =>
      current.filter((key) => selectedPlayer.props.some((prop) => prop.key === key))
    );
  }, [selectedPlayer]);

  const selectedProps = useMemo(() => {
    const allProps = players.flatMap((player) => player.props);
    return selectedPropKeys
      .map((key) => allProps.find((prop) => prop.key === key))
      .filter((prop): prop is ManualTrainingPropOption => Boolean(prop));
  }, [players, selectedPropKeys]);

  const togglePropSelection = (propKey: string) => {
    setSelectedPropKeys((current) =>
      current.includes(propKey) ? current.filter((key) => key !== propKey) : [...current, propKey]
    );
  };

  return {
    players,
    selectedPlayer,
    selectedPlayerName,
    setSelectedPlayerName,
    selectedPropKeys,
    selectedProps,
    togglePropSelection,
    formatPropType,
    isLoading: query.isLoading,
    isRefetching: query.isRefetching,
    error: query.error,
    refetch: query.refetch,
  };
}