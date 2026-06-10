import type { LiveGameState } from "@/features/live3d/types";
import type { PropQuote } from "@/features/live3d/types";
import { PitchPanel } from "./PitchPanel";
import { TerminalPanels } from "./panels";
import { EdgeBoard } from "./EdgeBoard";
import { useTerminalFeed } from "./hooks/useTerminalFeed";
import { useLivePBP } from "@/hooks/useLivePBP";

export function TerminalView({ state, quotes }: { state: LiveGameState; quotes: PropQuote[] }) {
  const feed = useTerminalFeed(state.game_id, quotes);
  const pbp = useLivePBP(state.game_id, state.status);

  return (
    <div className="flex flex-col gap-3 h-full">
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