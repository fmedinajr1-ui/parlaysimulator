import { LiveGameState } from "../types";

export function Scoreboard({ state }: { state: LiveGameState }) {
  const live = state.status === "in_progress";
  return (
    <div className="w-full bg-slate-900 border border-slate-800 rounded-lg px-4 py-3 flex items-center justify-between text-white">
      <div className="flex flex-col items-start gap-0.5">
        <span className="text-xs uppercase text-slate-400 tracking-wider">Away</span>
        <span className="text-sm md:text-base font-semibold truncate max-w-[120px] md:max-w-none">
          {state.away_team}
        </span>
        <span className="text-2xl md:text-4xl font-black tabular-nums">{state.away_score}</span>
      </div>
      <div className="flex flex-col items-center gap-1">
        <span className="text-[10px] uppercase tracking-widest text-slate-400">
          {state.league ?? state.sport}
        </span>
        <span className="text-sm md:text-base font-mono">
          {state.period ?? "—"} {state.clock ? `· ${state.clock}` : ""}
        </span>
        {live ? (
          <span className="inline-flex items-center gap-1.5 text-xs text-red-400">
            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" /> LIVE
          </span>
        ) : (
          <span className="text-xs text-slate-500 uppercase">{state.status}</span>
        )}
      </div>
      <div className="flex flex-col items-end gap-0.5">
        <span className="text-xs uppercase text-slate-400 tracking-wider">Home</span>
        <span className="text-sm md:text-base font-semibold truncate max-w-[120px] md:max-w-none">
          {state.home_team}
        </span>
        <span className="text-2xl md:text-4xl font-black tabular-nums">{state.home_score}</span>
      </div>
    </div>
  );
}