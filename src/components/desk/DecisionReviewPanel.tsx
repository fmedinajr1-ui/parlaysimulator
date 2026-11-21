import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PASS_KEY } from "@/components/AdminGate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { STAT_OPTIONS, type EdgePick } from "@/hooks/useResearchData";
import type { GameLog } from "@/utils/nbaBoxScoreMath";
import { reviewDecision, decisionShortlist, type DecisionMarket } from "@/utils/decisionReview";
import type { PPLine } from "@/utils/prizePicks";
import { useRememberedDeskState } from "@/hooks/useRememberedDeskState";
import { ScanSearch, ShieldAlert, Search } from "lucide-react";

interface Props {
  board: EdgePick[];
  byPlayer: Map<string, GameLog[]>;
  lineOdds: Map<string, { over: number | null; under: number | null }>;
  injuries: Map<string, string>;
  today: string;
  loading: boolean;
  onPick: (player: string) => void;
}
const key = (e: { player: string; stat: string }) => `${e.player.toLowerCase()}|${e.stat}`;
const label = (e: EdgePick) => `${e.player} · ${STAT_OPTIONS.find(s => s.key === e.stat)?.label ?? e.stat}`;
const pct = (n: number | null) => n == null ? "—" : `${(n * 100).toFixed(1)}%`;

export function DecisionReviewPanel({ board, byPlayer, lineOdds, injuries, today, loading, onPick }: Props) {
  const [market, setMarket] = useRememberedDeskState<DecisionMarket>("decision-market", "prizepicks");
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feed, setFeed] = useState<{ date: string; lines: PPLine[] } | null>(null);
  const [notice, setNotice] = useState("");
  const [manual, setManual] = useState<{ date: string; id: string; line: number }[]>([]);
  const [selected, setSelected] = useState("");
  const [line, setLine] = useState("");
  const [legs, setLegs] = useState("2");
  const [payout, setPayout] = useState("3");
  const [confirmed, setConfirmed] = useState(false);
  const [search, setSearch] = useState("");
  const [showPasses, setShowPasses] = useState(false);
  const options = useMemo(() => [...board].sort((a, b) => label(a).localeCompare(label(b))), [board]);
  const ppLines = useMemo(() => {
    const map = new Map((feed?.date === today ? feed.lines : []).map(e => [key(e), e.line]));
    for (const e of manual) if (e.date === today) map.set(e.id, e.line);
    return map;
  }, [feed, manual, today]);
  const rows = useMemo(() => {
    if (!reviewed) return [];
    return board.map(e => {
      const ppLine = ppLines.get(key(e));
      const odds = lineOdds.get(key(e))?.[e.side];
      const quote = market === "prizepicks"
        ? ppLine == null ? null : { market, line: ppLine, legs: Number(legs), payout: Number(payout), payoutConfirmed: confirmed }
        : { market, line: e.line, odds };
      return reviewDecision(e, byPlayer.get(e.player) ?? [], today, quote, injuries.get(e.player.toLowerCase()));
    });
  }, [reviewed, board, ppLines, market, legs, payout, confirmed, lineOdds, byPlayer, today, injuries]);
  const shortlist = useMemo(() => decisionShortlist(rows), [rows]);
  const counts = rows.reduce((c, r) => { c[r.status]++; return c; }, { review: 0, caution: 0, pass: 0, unavailable: 0 });
  const display = rows.filter(r => (showPasses || r.status === "review" || r.status === "caution") && (!search || label(r.pick).toLowerCase().includes(search.toLowerCase())))
    .sort((a, b) => (a.status === "review" ? 0 : a.status === "caution" ? 1 : 2) - (b.status === "review" ? 0 : b.status === "caution" ? 1 : 2) || (b.cushion ?? -1) - (a.cushion ?? -1));

  const scan = async () => {
    setReviewed(true);
    if (market !== "prizepicks") return;
    setBusy(true); setNotice("");
    try {
      const { data, error } = await supabase.functions.invoke("desk-bets", { body: { action: "prizepicks_board", passcode: localStorage.getItem(PASS_KEY) ?? "" } });
      if (error || data?.error || data?.blocked || !Array.isArray(data?.lines)) throw new Error("Board unavailable");
      setFeed({ date: today, lines: data.lines });
      if (!data.lines.length) setNotice("No standard PrizePicks lines were returned. Enter the exact line below.");
    } catch {
      setFeed(null);
      setNotice("PrizePicks board unavailable. Enter an exact standard line below; sportsbook lines will not be substituted.");
    } finally { setBusy(false); }
  };

  return <section aria-labelledby="decision-title" className="mb-6 border-y border-border py-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 id="decision-title" className="flex items-center gap-2 text-lg font-semibold"><ScanSearch className="text-primary" size={20} />Platform decision review</h2>
      <Button variant="outline" disabled={loading || busy} onClick={scan}><ScanSearch />{busy ? "Checking lines…" : "Check all props"}</Button>
    </div>
    <div className="mt-3 flex flex-wrap items-center gap-2" aria-label="Decision platform">
      <Button size="sm" variant={market === "prizepicks" ? "secondary" : "ghost"} onClick={() => { setMarket("prizepicks"); setReviewed(false); }}>PrizePicks</Button>
      <Button size="sm" variant={market === "sportsbook" ? "secondary" : "ghost"} onClick={() => { setMarket("sportsbook"); setReviewed(false); }}>Sportsbook</Button>
      <span className="text-xs text-muted-foreground">Polymarket · Not connected</span>
    </div>
    {market === "prizepicks" && <>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="text-xs text-muted-foreground">Power entry legs<Input aria-label="Power entry legs" type="number" min={2} max={6} step={1} value={legs} onChange={e => { setLegs(e.target.value); setConfirmed(false); }} className="mt-1" /></label>
        <label className="text-xs text-muted-foreground">Total payout multiplier<Input aria-label="Total payout multiplier" type="number" min={1.01} step="any" value={payout} onChange={e => { setPayout(e.target.value); setConfirmed(false); }} className="mt-1" /></label>
      </div>
      <label className="mt-3 flex items-start gap-2 text-xs"><Checkbox checked={confirmed} onCheckedChange={v => setConfirmed(v === true)} /><span>I confirmed this standard Power payout on PrizePicks. No Flex, demons, or goblins.</span></label>
      <form className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_120px_auto]" onSubmit={e => {
        e.preventDefault();
        if (!selected || !line.trim() || !Number.isFinite(Number(line)) || Number(line) < 0) return;
        setManual(prev => [...prev.filter(r => r.id !== selected), { date: today, id: selected, line: Number(line) }]);
        setReviewed(true);
      }}>
        <label className="min-w-0 text-xs text-muted-foreground">Player and prop
          <select aria-label="Player and prop" value={selected} onChange={e => setSelected(e.target.value)} className="mt-1 h-10 w-full min-w-0 rounded-md border border-input bg-background px-2 text-sm text-foreground">
            <option value="">Choose tonight's prop</option>
            {options.map(e => <option key={key(e)} value={key(e)}>{label(e)}</option>)}
          </select>
        </label>
        <label className="text-xs text-muted-foreground">PrizePicks line<Input aria-label="Exact PrizePicks line" type="number" step="any" min={0} value={line} onChange={e => setLine(e.target.value)} className="mt-1" /></label>
        <Button type="submit" variant="outline" className="self-end" disabled={!selected || !line.trim()}>Check exact line</Button>
      </form>
      {manual.some(r => r.date === today) && <p className="mt-2 text-xs text-muted-foreground">Manually entered lines · {today} · Confirm they are still available before betting.</p>}
      <p className="mt-2 text-xs text-muted-foreground">Per-leg hurdle assumes equal chances and independence. It is not a ticket profit forecast or a single-bet ladder payout.</p>
    </>}
    {notice && <p role="status" className="mt-3 text-sm text-muted-foreground">{notice}</p>}
    {reviewed && !busy && <>
      <div role="status" className="mt-4 border-l-2 border-primary pl-3 text-sm">
        <b>{rows.length} props checked</b> · {counts.review} clear for review · {counts.caution} caution · {counts.pass} pass · {counts.unavailable} unverified
        <p className="mt-1 text-muted-foreground">{shortlist.length ? `Diversified shortlist: ${shortlist.map(r => r.pick.player).join(", ")}.` : "No diversified shortlist clears every check. Passing is a valid decision."}</p>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Input aria-label="Search decision review" placeholder="Search player or prop" value={search} onChange={e => setSearch(e.target.value)} className="min-w-0 flex-1" />
        <Button variant={showPasses ? "secondary" : "outline"} onClick={() => setShowPasses(v => !v)}>{showPasses ? "Hide passes" : "Show passes"}</Button>
      </div>
      <ul className="mt-3 divide-y divide-border">
        {display.slice(0, 50).map(r => <li key={key(r.pick)} className="py-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0"><h3 className="font-semibold">{label(r.pick)}</h3><p className="mt-1 text-xs text-muted-foreground">{r.pick.side.toUpperCase()} {r.line ?? "—"} · {r.role} · {r.pick.home === true ? "HOME" : r.pick.home === false ? "ROAD" : "VENUE?"} vs {r.pick.tonight ?? "Unknown"}</p></div>
            <span className={`shrink-0 font-mono text-xs font-semibold ${r.status === "review" ? "text-primary" : "text-destructive"}`}>{r.status === "review" ? "REVIEW" : r.status === "unavailable" ? "UNVERIFIED" : r.status.toUpperCase()}</span>
          </div>
          <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
            <div><dt className="text-muted-foreground">Screen estimate</dt><dd className="mt-1 font-mono">{pct(r.estimate)}</dd></div>
            <div><dt className="text-muted-foreground">Break-even</dt><dd className="mt-1 font-mono">{pct(r.hurdle)}</dd></div>
            <div><dt className="text-muted-foreground">Gap</dt><dd className="mt-1 font-mono">{r.cushion == null ? "—" : `${r.cushion >= 0 ? "+" : ""}${(r.cushion * 100).toFixed(1)} pts`}</dd></div>
          </dl>
          <p className="mt-2 text-xs text-muted-foreground">Season / last 5: {r.seasonAverage?.toFixed(1) ?? "—"} / {r.recentAverage?.toFixed(1) ?? "—"} · Exact-line last 10: {r.hits}/{r.games}{r.pushes ? ` · ${r.pushes} ties` : ""}</p>
          {r.flags.length > 0 && <details className="mt-2 text-xs"><summary className="cursor-pointer text-destructive"><ShieldAlert size={12} className="mr-1 inline" />{r.flags.length} reason{r.flags.length > 1 ? "s" : ""} for caution / pass</summary><ul className="mt-2 space-y-1 text-muted-foreground">{r.flags.map(flag => <li key={flag}>• {flag}</li>)}</ul></details>}
          <Button variant="ghost" size="sm" className="mt-2" onClick={() => onPick(r.pick.player)}><Search />Review player</Button>
        </li>)}
      </ul>
      {display.length > 50 && <p className="text-xs text-muted-foreground">Showing 50 of {display.length}; narrow by player or prop.</p>}
      <p className="mt-3 text-xs text-muted-foreground">65% floor · 5-point break-even buffer · One player per team on the shortlist. These screens are unvalidated; shared model/simulation inputs are not independent confirmation. Original model picks and saved records remain unchanged.</p>
    </>}
  </section>;
}