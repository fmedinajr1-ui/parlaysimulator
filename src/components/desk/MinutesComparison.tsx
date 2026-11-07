import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PASS_KEY } from "@/components/AdminGate";
import { projectMinutes } from "@/utils/projectedMinutes";
import { MODEL_VERSION } from "@/utils/nbaProjection";
import { V6_MODEL_VERSION, type minutesAccuracy } from "@/utils/minutesValidation";
import type { GameLog } from "@/utils/nbaBoxScoreMath";
import type { EdgePick } from "@/hooks/useResearchData";

export function MinutesComparison({ board, v5, v6, byPlayer, today }: {
  board: EdgePick[]; v5: EdgePick[]; v6: EdgePick[]; byPlayer: Map<string, GameLog[]>; today: string;
}) {
  const [accuracy, setAccuracy] = useState<ReturnType<typeof minutesAccuracy> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ game_date: string; model_version: string; status: string; odds: number }[]>([]);
  useEffect(() => {
    if (!board.length) return;
    let alive = true;
    (async () => {
      try {
        const passcode = localStorage.getItem(PASS_KEY) ?? "";
        const forecasts = [...new Map(board.map((e) => [e.player, e])).values()].flatMap((e) => {
          const m = projectMinutes(byPlayer.get(e.player) ?? [], today, e.mateMinutesOut ?? 0);
          return m && e.team ? [{ game_date: today, player_name: e.player, team: e.team, projected_minutes: m.minutes, baseline_minutes: m.l10 }] : [];
        });
        const snapshot = await supabase.functions.invoke("desk-bets", { body: { action: "log_minutes", passcode, forecasts } });
        if (snapshot.error) throw snapshot.error;
        const check = await supabase.functions.invoke("desk-bets", { body: { action: "minutes_record", passcode } });
        if (check.error || !check.data?.accuracy) throw check.error ?? new Error("Minutes record unavailable");
        if (alive) { setAccuracy(check.data.accuracy); setError(null); }
        if (check.data.accuracy.ready) {
          const picks = [ ...v5.map((e) => ({ e, version: MODEL_VERSION })), ...v6.map((e) => ({ e, version: V6_MODEL_VERSION })) ].map(({ e, version }, i) => ({
            game_date: today, player_name: e.player, stat: e.stat, side: e.side, line: e.line, odds: e.odds,
            projection: e.median, win_prob: e.hitRate, ev: e.ev, opponent: e.tonight, this_season: e.thisSeason,
            reasons: e.reasons, rank: i % 4 + 1, model_version: version,
          }));
          const log = await supabase.functions.invoke("desk-bets", { body: { action: "log_picks", passcode, picks } });
          if (log.error) throw log.error;
        }
        const record = await supabase.functions.invoke("desk-bets", { body: { action: "pick_record", passcode } });
        if (record.error) throw record.error;
        if (alive) setSaved(record.data?.picks ?? []);
      } catch { if (alive) setError("Minutes tracking unavailable — v5 remains active."); }
    })();
    return () => { alive = false; };
  }, [board, v5, v6, byPlayer, today]);
  const sharedDates = new Set(saved.filter((r) => r.model_version === V6_MODEL_VERSION).map((r) => r.game_date));
  return <section className="mb-3 border-b border-border py-3 font-mono text-xs" aria-label="Minutes accuracy and model comparison">
    <h2 className="mb-2 text-sm font-semibold">Minutes accuracy · v6 trial</h2>
    <p className="text-muted-foreground">{error ?? (accuracy ? `${accuracy.slates}/3 completed slates · ${accuracy.samples} players · average error ${accuracy.mae == null ? "—" : accuracy.mae.toFixed(2) + " min"} · ${accuracy.pending} awaiting results` : "Checking saved forecasts…")}</p>
    <p className="mt-1 text-muted-foreground">{accuracy?.ready ? "Accuracy confirmed · v6 trial alongside unchanged v5" : "V5 active · v6 waits for 3 slates averaging ≤2 min error"}</p>
    {accuracy?.ready && <div className="mt-3 grid gap-4 sm:grid-cols-2">{[{ version: MODEL_VERSION, picks: v5 }, { version: V6_MODEL_VERSION, picks: v6 }].map(({ version, picks }) => {
      const results = saved.filter((r) => r.model_version === version && sharedDates.has(r.game_date));
      const won = results.filter((r) => r.status === "won"), lost = results.filter((r) => r.status === "lost");
      const units = won.reduce((n, r) => n + (r.odds > 0 ? r.odds / 100 : 100 / -r.odds), 0) - lost.length;
      return <div key={version}><h3 className="mb-1 font-semibold">{version}</h3>
        <p className="mb-2 text-muted-foreground">Same trial dates: {won.length}–{lost.length} · {units.toFixed(2)}u · {results.filter((r) => r.status === "open").length} open</p>
        {picks.length ? picks.map((e) => <div className="flex flex-wrap justify-between gap-2 border-t border-border py-2" key={`${e.player}|${e.stat}`}>
          <span>{e.player} · {e.side} {e.line} {e.stat.replaceAll("_", " ")}</span><span className="text-primary">Proj {e.median} · {Math.round(e.hitRate * 100)}%</span>
        </div>) : <p className="text-muted-foreground">No qualifying picks</p>}</div>;
    })}</div>}
  </section>;
}