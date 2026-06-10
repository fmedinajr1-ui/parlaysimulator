import type { LiveGameState } from "@/features/live3d/types";
import type { PropQuote } from "@/features/live3d/types";
import { PitchPanel } from "./PitchPanel";
import { TerminalPanels } from "./panels";
import { EdgeBoard } from "./EdgeBoard";
import { useTerminalFeed } from "./hooks/useTerminalFeed";
import { useLivePBP } from "@/hooks/useLivePBP";

export function TerminalView({
  state,
  quotes,
  quotaExceeded,
}: {
  state: LiveGameState;
  quotes: PropQuote[];
  quotaExceeded?: boolean;
}) {
  const feed = useTerminalFeed(state.game_id, quotes);
  const pbp = useLivePBP(state.game_id, state.status);

  return (
    <div className="flex flex-col gap-3 h-full">
      <div className="flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-widest text-slate-500">
        <span>Live Terminal</span>
        <span className="text-slate-700">·</span>
        <span className="text-slate-400">{feed.rows.length} edges</span>
        {feed.lastUpdated && (
          <>
            <span className="text-slate-700">·</span>
            <span className="text-slate-400">Updated {timeAgo(feed.lastUpdated)}</span>
          </>
        )}
        {quotaExceeded && (
          <span className="ml-auto rounded-full border border-amber-700/40 bg-amber-950/40 text-amber-300 px-2 py-0.5 normal-case tracking-normal">
            Odds quota exceeded — quotes paused
          </span>
        )}
      </div>
      <div className="flex-1 min-h-[360px]">
        <PitchPanel
          state={state}
          playerStates={feed.playerStates}
          edgeRows={feed.rows}
          recentPlays={pbp.data?.recentPlays ?? []}
        />
      </div>
      <TerminalPanels
        state={state}
        playerStates={feed.playerStates}
        edgeRows={feed.rows}
        signalCount={feed.signalCount}
        hasProjections={feed.hasProjections}
        pbpAvailable={!!pbp.data?.recentPlays?.length}
      />
      <EdgeBoard rows={feed.rows} />
    </div>
  );
}

function timeAgo(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}