import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PASS_KEY } from "@/components/AdminGate";
import { projectMinutes } from "@/utils/projectedMinutes";
import { MODEL_VERSION } from "@/utils/nbaProjection";
import { V6_MODEL_VERSION, type minutesAccuracy } from "@/utils/minutesValidation";
import { pairModelPicks, summarizeModelResults, type ComparablePick, type ModelResult } from "@/utils/modelComparison";
import type { GameLog } from "@/utils/nbaBoxScoreMath";
import type { EdgePick } from "@/hooks/useResearchData";

type SavedPick = ModelResult & { player_name: string; stat: string; side: string; line: number };

export function MinutesComparison({ board, v5, v6, byPlayer, today }: {
  board: EdgePick[]; v5: EdgePick[]; v6: EdgePick[]; byPlayer: Map<string, GameLog[]>; today: string;
}) {
  const [accuracy, setAccuracy] = useState<ReturnType<typeof minutesAccuracy> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<SavedPick[]>([]);
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
          const picks = [
            ...v5.map((e, i) => ({ e, version: MODEL_VERSION, rank: i + 1 })),
            ...v6.map((e, i) => ({ e, version: V6_MODEL_VERSION, rank: i + 1 })),
          ].map(({ e, version, rank }) => ({
            game_date: today, player_name: e.player, stat: e.stat, side: e.side, line: e.line, odds: e.odds,
            projection: e.median, win_prob: e.hitRate, ev: e.ev, opponent: e.tonight, this_season: e.thisSeason,
            reasons: e.reasons, rank, model_version: version,
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
  const paired = useMemo(() => pairModelPicks(v5, v6), [v5, v6]);
  const cell = (pick: ComparablePick | undefined, version: string) => {
    if (!pick) return <span className="text-muted-foreground">No qualifying pick</span>;
    const result = saved.find((r) => r.game_date === today && r.model_version === version && r.player_name === pick.player && r.stat === pick.stat && r.side === pick.side && Number(r.line) === pick.line);
    return <div>
      <p className="font-semibold capitalize">{pick.side} {pick.line}</p>
      <p>Proj {pick.median} · {Math.round(pick.hitRate * 100)}%</p>
      <p className="text-primary">+{(pick.ev * 100).toFixed(1)}¢ / $1</p>
      {result && <p className={result.status === "lost" ? "text-destructive" : "text-primary"}>{result.status.toUpperCase()}</p>}
    </div>;
  };

  return <section className="mb-3 border-b border-border py-3 font-mono text-xs" aria-label="Minutes accuracy and model comparison">
    <h2 className="mb-2 text-sm font-semibold">Minutes accuracy · automatic v6 trial</h2>
    <p className="text-muted-foreground">{error ?? (accuracy ? `${accuracy.slates}/3 completed slates · ${accuracy.samples} players · average error ${accuracy.mae == null ? "—" : accuracy.mae.toFixed(2) + " min"} · ${accuracy.pending} awaiting results` : "Checking saved forecasts…")}</p>
    <p className="mt-1 text-muted-foreground">{accuracy?.ready ? "Accuracy passed · v6 shadow picks active; v5 remains unchanged" : "V5 active · v6 unlocks automatically at 3 slates averaging ≤2 min error"}</p>
    <p className="mt-1 text-muted-foreground">{V6_MODEL_VERSION} · Shot-volume adjustment for points; complete-game assists/rebounds allowances replace the old defense factor; plus-minus is context only.</p>
    <div className="mt-3">
      <div className="mb-3 grid gap-2 sm:grid-cols-2">{[{ version: MODEL_VERSION, label: "V5" }, { version: V6_MODEL_VERSION, label: "V6" }].map(({ version, label }) => {
        const result = summarizeModelResults(saved, version, sharedDates);
        return <p className="border border-border p-2 text-muted-foreground" key={version}><span className="font-semibold text-foreground">{label} same-slate results</span><br />{result.w}–{result.l}–{result.p} · {result.units >= 0 ? "+" : ""}{result.units.toFixed(2)}u · {result.open} open</p>;
      })}</div>
      <div className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)] gap-2 border-b border-border pb-1 text-muted-foreground"><span>Player · prop</span><span>V5</span><span>V6</span></div>
      {paired.length ? paired.map((row) => <div className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)] gap-2 border-b border-border py-2" key={row.key}>
        <span className="break-words">{row.player}<br /><span className="text-muted-foreground">{row.stat.replace(/_/g, " ")}</span></span>
        <span>{cell(row.v5, MODEL_VERSION)}</span><span>{cell(row.v6, V6_MODEL_VERSION)}</span>
      </div>) : <p className="mt-2 text-muted-foreground">No qualifying picks on either model</p>}
    </div>
  </section>;
}
