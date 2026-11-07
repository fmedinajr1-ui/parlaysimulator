export interface GameCoveragePlayerInput {
  player: string;
  team: string;
  opponent: string | null;
  home: boolean | null;
  stat: string;
}

export interface CoveragePick {
  player: string;
  stat: string;
  side: "over" | "under";
  line: number;
}

export interface CoveredPlayer {
  player: string;
  team: string;
  home: boolean;
  props: string[];
  picks: CoveragePick[];
}

export interface GameCoverage {
  id: string;
  label: string;
  away: string;
  home: string;
  players: CoveredPlayer[];
  playerCount: number;
  propCount: number;
  pickCount: number;
}

const playerKey = (name: string) => name.trim().toLowerCase();

/**
 * Groups tonight's lined players into games. A player appears only when his
 * venue is known and he has game history; picks are attached afterwards.
 */
export function buildGameCoverage(
  rows: GameCoveragePlayerInput[],
  picks: CoveragePick[],
): GameCoverage[] {
  const games = new Map<string, {
    away: string;
    home: string;
    players: Map<string, { player: string; team: string; home: boolean; props: Set<string> }>;
  }>();

  for (const row of rows) {
    if (row.home === null || !row.opponent || !row.team || !row.player) continue;
    const away = row.home ? row.opponent : row.team;
    const home = row.home ? row.team : row.opponent;
    const id = `${away} @ ${home}`;
    const game = games.get(id) ?? { away, home, players: new Map() };
    const key = playerKey(row.player);
    const player = game.players.get(key) ?? {
      player: row.player,
      team: row.team,
      home: row.home,
      props: new Set<string>(),
    };
    player.props.add(row.stat);
    game.players.set(key, player);
    games.set(id, game);
  }

  const picksByPlayer = new Map<string, CoveragePick[]>();
  for (const pick of picks) {
    const key = playerKey(pick.player);
    picksByPlayer.set(key, [...(picksByPlayer.get(key) ?? []), pick]);
  }

  return [...games.entries()].map(([id, game]) => {
    const players = [...game.players.values()].map((player) => ({
      player: player.player,
      team: player.team,
      home: player.home,
      props: [...player.props].sort(),
      picks: picksByPlayer.get(playerKey(player.player)) ?? [],
    })).sort((a, b) => b.picks.length - a.picks.length || a.player.localeCompare(b.player));

    return {
      id,
      label: id,
      away: game.away,
      home: game.home,
      players,
      playerCount: players.length,
      propCount: players.reduce((total, player) => total + player.props.length, 0),
      pickCount: players.reduce((total, player) => total + player.picks.length, 0),
    };
  }).sort((a, b) => b.pickCount - a.pickCount || a.label.localeCompare(b.label));
}
