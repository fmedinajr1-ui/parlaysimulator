import { useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useLiveGameState, usePropQuotes } from "@/features/live3d/hooks";
import { SPORT_KEY } from "@/features/live3d/types";
import { Scoreboard } from "@/features/live3d/components/Scoreboard";
import { TerminalView } from "@/features/liveterminal/TerminalView";

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
    const id = setInterval(fire, 30_000);
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
      <div className="h-[70vh] lg:h-[calc(100vh-180px)]">
        <TerminalView state={state} quotes={quotes} quotaExceeded={quotaExceeded} />
      </div>
    </div>
  );
}