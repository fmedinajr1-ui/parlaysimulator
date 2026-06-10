import { Link } from "react-router-dom";
import { useLiveGames } from "@/features/live3d/hooks";

export default function LiveGames() {
  const { games, loading } = useLiveGames();
  const live = games.filter((g) => g.status === "in_progress");
  const upcoming = games.filter((g) => g.status === "scheduled").slice(0, 30);

  return (
    <div className="min-h-screen bg-slate-950 text-white p-4 md:p-8">
      <h1 className="text-2xl md:text-3xl font-bold mb-2">Live Games · 3D View</h1>
      <p className="text-sm text-slate-400 mb-6">
        Open any live game for a 3D broadcast view, sticky scoreboard, and side-by-side sportsbook
        prop comparison.
      </p>

      <section className="mb-8">
        <h2 className="text-xs uppercase tracking-widest text-slate-500 mb-3">
          Live now ({live.length})
        </h2>
        {loading && <div className="text-slate-500 text-sm">Loading…</div>}
        {!loading && !live.length && (
          <div className="text-slate-500 text-sm">
            No games currently live. The score sync runs every minute.
          </div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {live.map((g) => (
            <Link
              key={g.game_id}
              to={`/live/${encodeURIComponent(g.game_id)}`}
              className="block rounded-lg border border-slate-800 bg-slate-900 hover:border-emerald-500/60 transition p-3"
            >
              <div className="text-[10px] uppercase tracking-widest text-emerald-400 mb-1 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> LIVE ·{" "}
                {g.sport}
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium truncate">{g.away_team}</span>
                <span className="text-xl font-black tabular-nums">{g.away_score}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium truncate">{g.home_team}</span>
                <span className="text-xl font-black tabular-nums">{g.home_score}</span>
              </div>
              <div className="text-xs text-slate-500 mt-1">
                {g.period ?? ""} {g.clock ?? ""}
              </div>
            </Link>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-xs uppercase tracking-widest text-slate-500 mb-3">Upcoming</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {upcoming.map((g) => (
            <Link
              key={g.game_id}
              to={`/live/${encodeURIComponent(g.game_id)}`}
              className="block rounded-md border border-slate-800 bg-slate-900/50 hover:border-slate-600 p-3 text-sm"
            >
              <div className="text-[10px] uppercase text-slate-500 mb-1">{g.sport}</div>
              <div className="truncate">
                {g.away_team} @ {g.home_team}
              </div>
              <div className="text-xs text-slate-500">
                {g.commence_time && new Date(g.commence_time).toLocaleString()}
              </div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}