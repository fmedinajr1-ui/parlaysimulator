import { useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useLiveGameState, usePropQuotes } from "@/features/live3d/hooks";
import { SPORT_KEY } from "@/features/live3d/types";
import { SceneFrame } from "@/features/live3d/scenes/SceneFrame";
import { BasketballScene } from "@/features/live3d/scenes/BasketballScene";
import { BaseballScene } from "@/features/live3d/scenes/BaseballScene";
import { GenericFieldScene } from "@/features/live3d/scenes/GenericFieldScene";
import { Scoreboard } from "@/features/live3d/components/Scoreboard";
import { PropBookGrid } from "@/features/live3d/components/PropBookGrid";

export default function LiveGame() {
  const { gameId } = useParams<{ gameId: string }>();
  const { state, loading } = useLiveGameState(gameId);
  const { quotes, quotaExceeded, setQuotaExceeded } = usePropQuotes(gameId);

  // Trigger a multi-book sync on mount + every 60s while viewing.
  useEffect(() => {
    if (!state) return;
    const sport_key = SPORT_KEY[state.sport];
    if (!sport_key) return;
    const fire = () =>
      supabase.functions
        .invoke("multibook-props-sync", {
          body: { event_id: state.game_id, sport_key, sport: state.sport },
        })
        .then((res) => {
          const data = res?.data as { quota_exceeded?: boolean } | null;
          if (data?.quota_exceeded) setQuotaExceeded(true);
          else if (quotaExceeded) setQuotaExceeded(false);
        })
        .catch(() => {});
    fire();
    const id = setInterval(fire, 60_000);
    return () => clearInterval(id);
  }, [state, quotaExceeded, setQuotaExceeded]);

  if (loading) {
    return (
      <div className="min-h-screen grid place-items-center bg-slate-950 text-slate-400">
        Loading game…
      </div>
    );
  }
  if (!state) {
    return (
      <div className="min-h-screen grid place-items-center bg-slate-950 text-slate-400">
        <div className="text-center">
          <div>Game not found.</div>
          <Link to="/live" className="text-emerald-400 underline text-sm mt-2 inline-block">
            Back to live games
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white p-3 md:p-6">
      <Link to="/live" className="text-xs text-slate-400 hover:text-white">
        ← All live games
      </Link>
      <div className="mt-2 mb-3">
        <Scoreboard state={state} />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-4">
        <div className="h-[60vh] lg:h-[calc(100vh-180px)]">
          <SceneFrame>{renderScene(state)}</SceneFrame>
        </div>
        <aside className="bg-slate-950">
          <h3 className="text-xs uppercase tracking-widest text-slate-500 mb-2">
            Multi-book prop comparison
          </h3>
          {quotaExceeded && (
            <div className="mb-2 text-xs rounded-md border border-amber-700/40 bg-amber-950/40 text-amber-300 px-3 py-2">
              Odds provider quota exceeded. Live prop quotes are paused until the
              key tops up or the monthly reset.
            </div>
          )}
          <PropBookGrid quotes={quotes} />
        </aside>
      </div>
    </div>
  );
}

function renderScene(state: ReturnType<typeof useLiveGameState>["state"]) {
  if (!state) return null;
  switch (state.sport) {
    case "NBA":
    case "WNBA":
    case "NCAAB":
      return <BasketballScene state={state} />;
    case "MLB":
      return <BaseballScene state={state} />;
    case "NFL":
    case "NCAAF":
      return <GenericFieldScene state={state} kind="football" perSide={11} />;
    case "NHL":
      return <GenericFieldScene state={state} kind="hockey" perSide={6} />;
    case "Soccer":
      return <GenericFieldScene state={state} kind="soccer" perSide={11} />;
    default:
      return <GenericFieldScene state={state} kind="soccer" perSide={5} />;
  }
}