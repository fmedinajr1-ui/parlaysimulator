import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";
import "@/components/desk/desk-tokens.css";
import { STAT_OPTIONS, useResearchData } from "@/hooks/useResearchData";
import { supabase } from "@/integrations/supabase/client";
import { PASS_KEY } from "@/components/AdminGate";
import { betPnl, summarize, winProfit, type BetStatus, type PaperBet, type Side } from "@/utils/paperBets";
import { legKey, parlayOdds, parlayStatus, readSlip, SLIP_EVENT, toggleLeg, writeSlip, type SlipLeg } from "@/utils/betSlip";
import { statValue, type StatKey } from "@/utils/nbaBoxScoreMath";
import { hedgePlan, isDanger, liveLegProb, livePredictionAvailable, parlayCashProb } from "@/utils/liveHedge";

const fmt = (n: number) => `${n < 0 ? "-" : ""}$${Math.abs(n).toFixed(2)}`;
const fmtOdds = (o: number) => (o > 0 ? `+${o}` : String(o));
const statLabel = (s: StatKey) => STAT_OPTIONS.find((o) => o.key === s)?.label ?? s;

type Row = {
  id: string; player_name: string; stat: StatKey; side: Side; line: number; odds: number; stake: number;
  book: string | null; game_date: string; placed_at: string; status: BetStatus; result_value: number | null;
  parlay_id: string | null; parlay_odds: number | null;
};
type Live = Record<string, { value: number; minutes: number; clock: string; final: boolean; period?: number; clockSec?: number }>;
type Ticket = { id: string; legs: Row[]; stake: number; odds: number; status: BetStatus; book: string | null; date: string; parlay: boolean };

export default function MyBets() {
  const { byPlayer, propLines, lineOdds, tonight, today, loading } = useResearchData();
  const [rows, setRows] = useState<Row[]>([]);
  const [live, setLive] = useState<Live>({});
  const [err, setErr] = useState("");
  const [slip, setSlip] = useState<SlipLeg[]>(readSlip);
  const [stake, setStake] = useState("");
  const [book, setBook] = useState(() => localStorage.getItem("real_last_book") || "FanDuel");
  const [asParlay, setAsParlay] = useState(true);
  const [start, setStart] = useState<number>(() => Number(localStorage.getItem("real_bankroll_v1")) || 0);
  const [bankInput, setBankInput] = useState("");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [hedgeOdds, setHedgeOdds] = useState<Record<string, string>>({});
  const [aiNote, setAiNote] = useState<Record<string, string>>({});
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  // Pregame minutes and per-minute rate from the player's last 10 played games.
  const pregame = useCallback((name: string, stat: StatKey) => {
    const key = [...byPlayer.keys()].find((n) => n.toLowerCase() === name.toLowerCase());
    const g = (key ? byPlayer.get(key) ?? [] : []).filter((x) => Number(x.minutes_played) > 0)
      .sort((a, b) => b.game_date.localeCompare(a.game_date)).slice(0, 10);
    if (!g.length) return { avgMinutes: 30, ratePerMin: 0 };
    const mins = g.reduce((t, x) => t + Number(x.minutes_played), 0);
    return { avgMinutes: mins / g.length, ratePerMin: g.reduce((t, x) => t + statValue(x, stat), 0) / mins };
  }, [byPlayer]);

  const legProb = useCallback((l: Row) => {
    if (l.status === "won") return 1;
    if (l.status === "lost") return 0;
    if (l.status === "void" || l.status === "push") return null;
    const lv = live[l.id];
    const pg = pregame(l.player_name, l.stat);
    if (!livePredictionAvailable(lv, pg)) return null;
    return liveLegProb({ side: l.side, line: Number(l.line), value: lv?.value ?? 0, minutesPlayed: lv?.minutes ?? 0,
      period: lv?.period ?? 0, clockSec: lv?.clockSec ?? 720, final: !!lv?.final, ...pg }).prob;
  }, [live, pregame]);

  const askAi = async (t: Ticket, info: unknown) => {
    setAiNote((m) => ({ ...m, [t.id]: "Thinking…" }));
    const { data, error } = await supabase.functions.invoke("research-ai", { body: { mode: "hedge", ticket: info } });
    let msg = data?.text ?? data?.error;
    if (!msg && error) { try { msg = (await (error as any).context?.json())?.error; } catch { /* ignore */ } }
    setAiNote((m) => ({ ...m, [t.id]: msg || "AI couldn't answer right now." }));
  };

  useEffect(() => { const f = () => setSlip(readSlip()); window.addEventListener(SLIP_EVENT, f); return () => window.removeEventListener(SLIP_EVENT, f); }, []);
  useEffect(() => localStorage.setItem("real_bankroll_v1", String(start)), [start]);

  const call = useCallback(async (body: Record<string, unknown>) => {
    const { data, error } = await supabase.functions.invoke("desk-bets", { body: { passcode: localStorage.getItem(PASS_KEY) ?? "", ...body } });
    if (error || !data?.bets) { setErr("Couldn't reach your saved bets. Try again."); return false; }
    setErr("");
    setRows(data.bets as Row[]);
    if (data.live) { setLive(data.live as Live); setUpdatedAt(new Date()); }
    return true;
  }, []);

  // Live scores while the page is open: every 60s when something is still open.
  const hasOpen = rows.some((r) => r.status === "open");
  useEffect(() => { call({ action: "live" }); }, [call]);
  useEffect(() => {
    if (!hasOpen) return;
    const t = setInterval(() => { if (document.visibilityState === "visible") call({ action: "live" }); }, 60_000);
    const resume = () => { if (document.visibilityState === "visible") call({ action: "live" }); };
    document.addEventListener("visibilitychange", resume);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", resume); };
  }, [hasOpen, call]);

  const tickets: Ticket[] = useMemo(() => {
    const groups = new Map<string, Row[]>();
    for (const r of rows) { const k = r.parlay_id ?? r.id; groups.set(k, [...(groups.get(k) ?? []), r]); }
    return [...groups].map(([id, legs]) => {
      const parlay = !!legs[0].parlay_id;
      const g = parlay ? parlayStatus(legs.map((l) => ({ status: l.status, odds: l.odds }))) : { status: legs[0].status, odds: legs[0].odds };
      return { id, legs, stake: Number(legs[0].stake), odds: g.odds, status: g.status, book: legs[0].book, date: legs[0].game_date, parlay };
    });
  }, [rows]);

  const sum = summarize(start, tickets.map((t) => ({ bet: { stake: t.stake, odds: t.odds } as PaperBet, status: t.status })));

  const props = useMemo(() => {
    const out: SlipLeg[] = [];
    for (const [k, line] of propLines) {
      const [lower, stat] = k.split("|");
      const player = [...byPlayer.keys()].find((n) => n.toLowerCase() === lower) ?? lower.replace(/\b[a-z]/g, (c) => c.toUpperCase());
      const o = lineOdds.get(k);
      out.push({ player, stat: stat as StatKey, line, side: "over", odds: o?.over ?? -110, opp: tonight.get(lower) ?? null });
      out.push({ player, stat: stat as StatKey, line, side: "under", odds: o?.under ?? -110, opp: tonight.get(lower) ?? null });
    }
    const f = q.trim().toLowerCase();
    return f ? out.filter((p) => p.player.toLowerCase().includes(f)) : [];
  }, [propLines, lineOdds, byPlayer, tonight, q]);

  const stakeNum = Number(stake);
  const parlay = asParlay && slip.length > 1;
  const combined = parlay ? parlayOdds(slip.map((l) => l.odds)) : 0;
  const toWin = parlay ? winProfit(stakeNum || 0, combined) : slip.reduce((s, l) => s + winProfit(stakeNum || 0, l.odds), 0);
  const canSubmit = slip.length > 0 && stakeNum > 0 && slip.every((l) => Math.abs(l.odds) >= 100) && !busy;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    const pid = parlay ? crypto.randomUUID() : null;
    const ok = await call({
      action: "add",
      bets: slip.map((l) => ({
        player_name: l.player, stat: l.stat, side: l.side, line: l.line, odds: l.odds, stake: stakeNum, book,
        game_date: today, placed_at: new Date().toISOString(), parlay_id: pid, parlay_odds: pid ? combined : null,
      })),
    });
    setBusy(false);
    if (ok) { writeSlip([]); setStake(""); localStorage.setItem("real_last_book", book); call({ action: "live" }); }
  };

  const updateLeg = (i: number, patch: Partial<SlipLeg>) => writeSlip(slip.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const inSlip = new Set(slip.map((l) => `${legKey(l)}|${l.side}`));

  return (
    <div className="desk-theme desk-grid-bg min-h-screen">
      <header className="sticky top-0 z-30 border-b border-[hsl(var(--desk-line))] bg-[hsl(var(--desk-bg)/0.9)] px-3 py-3 backdrop-blur sm:px-4">
        <div className="mx-auto flex max-w-[1100px] items-center justify-between gap-3 pr-14 sm:pr-0">
          <div>
            <div className="desk-display text-lg font-bold">My bets</div>
            <div className="desk-label mt-1">Build singles or parlays · live scores · graded from box scores</div>
          </div>
          <Link to="/" className="desk-tab">← Desk</Link>
        </div>
      </header>

      <main className="mx-auto max-w-[1100px] space-y-3 px-3 pb-16 pt-3 sm:px-4">
        <section className="desk-panel grid grid-cols-2 gap-3 p-3 sm:grid-cols-4">
          {[["Bankroll", fmt(sum.bankroll)], ["Profit", fmt(sum.profit)], ["Open stakes", fmt(sum.atRisk)], ["Record", `${sum.won}-${sum.lost}`]].map(([l, v], i) => (
            <div key={l}>
              <div className="desk-label">{l}</div>
              <div className={`desk-mono text-lg font-semibold ${i === 1 ? (sum.profit >= 0 ? "text-[hsl(var(--desk-amber))]" : "text-destructive") : ""}`}>{v}</div>
            </div>
          ))}
          <div className="col-span-2 flex items-center gap-2 sm:col-span-4">
            <input inputMode="decimal" placeholder={start ? `Starting money: ${fmt(start)}` : "Your bankroll (optional), e.g. 500"} value={bankInput}
              onChange={(e) => setBankInput(e.target.value.replace(/[^\d.]/g, ""))}
              className="min-w-0 flex-1 rounded-md border border-[hsl(var(--desk-line))] bg-[hsl(var(--desk-bg))] px-3 py-2 text-sm" />
            <button className="desk-tab" data-active="true" onClick={() => { const n = Number(bankInput); if (n > 0) { setStart(n); setBankInput(""); } }}>{start ? "Change" : "Set"}</button>
          </div>
          {err && <p className="col-span-2 text-sm text-destructive sm:col-span-4">{err}</p>}
        </section>

        <div className="grid gap-3 lg:grid-cols-12">
          <section className="desk-panel space-y-2 p-3 lg:col-span-5">
            <div className="flex items-center justify-between">
              <div className="desk-label">Bet slip ({slip.length})</div>
              {slip.length > 0 && <button className="desk-mono text-[11px] underline" onClick={() => writeSlip([])}>clear</button>}
            </div>
            {!slip.length ? (
              <p className="text-sm text-[hsl(var(--desk-muted))]">Tap "Add to my bets" on a desk pick, or search a player below.</p>
            ) : (
              <>
                <ul className="divide-y divide-[hsl(var(--desk-line))]">
                  {slip.map((l, i) => (
                    <li key={`${legKey(l)}|${l.side}`} className="space-y-1 py-2 text-sm">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <b>{l.player}</b> {l.side === "over" ? "Over" : "Under"} {l.line} {statLabel(l.stat)}
                          {l.opp && <div className="desk-mono text-[11px] text-[hsl(var(--desk-muted))]">vs {l.opp}</div>}
                        </div>
                        <button aria-label="Remove pick" className="desk-mono px-2 text-[hsl(var(--desk-muted))]" onClick={() => toggleLeg(l)}>✕</button>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <label className="desk-label">Line
                          <input inputMode="decimal" defaultValue={l.line} onBlur={(e) => updateLeg(i, { line: Number(e.target.value) || l.line })}
                            className="mt-1 w-full rounded-md border border-[hsl(var(--desk-line))] bg-[hsl(var(--desk-bg))] px-2 py-1.5 text-sm" />
                        </label>
                        <label className="desk-label">Odds
                          <input defaultValue={l.odds} onBlur={(e) => updateLeg(i, { odds: Number(e.target.value) || l.odds })}
                            className="mt-1 w-full rounded-md border border-[hsl(var(--desk-line))] bg-[hsl(var(--desk-bg))] px-2 py-1.5 text-sm" />
                        </label>
                      </div>
                    </li>
                  ))}
                </ul>
                {slip.length > 1 && (
                  <div className="flex gap-1">
                    <button className="desk-tab flex-1" data-active={asParlay} onClick={() => setAsParlay(true)}>Parlay {fmtOdds(parlayOdds(slip.map((l) => l.odds)))}</button>
                    <button className="desk-tab flex-1" data-active={!asParlay} onClick={() => setAsParlay(false)}>{slip.length} singles</button>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-2">
                  <input inputMode="decimal" placeholder={parlay || slip.length === 1 ? "Stake $" : "Stake $ each"} value={stake}
                    onChange={(e) => setStake(e.target.value.replace(/[^\d.]/g, ""))}
                    className="rounded-md border border-[hsl(var(--desk-line))] bg-[hsl(var(--desk-bg))] px-3 py-2 text-sm" />
                  <input placeholder="Book" value={book} onChange={(e) => setBook(e.target.value)}
                    className="rounded-md border border-[hsl(var(--desk-line))] bg-[hsl(var(--desk-bg))] px-3 py-2 text-sm" />
                </div>
                <div className="desk-mono text-xs text-[hsl(var(--desk-muted))]">To win {fmt(toWin)}</div>
                <button disabled={!canSubmit} onClick={submit}
                  className="w-full rounded-md bg-[hsl(var(--desk-amber))] py-2.5 text-sm font-bold text-[hsl(var(--desk-bg))] disabled:opacity-40">
                  {busy ? "Saving…" : parlay ? `Submit ${slip.length}-leg parlay` : slip.length > 1 ? `Submit ${slip.length} bets` : "Submit bet"}
                </button>
              </>
            )}

            <div className="pt-2">
              <input placeholder="Add any prop: search player" value={q} onChange={(e) => setQ(e.target.value)}
                className="w-full rounded-md border border-[hsl(var(--desk-line))] bg-[hsl(var(--desk-bg))] px-3 py-2 text-sm" />
              {q && (loading && !props.length ? <p className="desk-mono mt-2 text-xs">Loading…</p> : !props.length ? <p className="desk-mono mt-2 text-xs text-[hsl(var(--desk-muted))]">No lines found tonight.</p> : (
                <ul className="mt-2 max-h-72 divide-y divide-[hsl(var(--desk-line))] overflow-y-auto">
                  {props.map((p) => {
                    const on = inSlip.has(`${legKey(p)}|${p.side}`);
                    return (
                      <li key={`${legKey(p)}|${p.side}`} className="flex items-center justify-between gap-2 py-1.5 text-sm">
                        <span className="truncate">{p.player} {p.side === "over" ? "O" : "U"} {p.line} {statLabel(p.stat)}</span>
                        <button className="desk-tab desk-mono shrink-0 text-xs" data-active={on} onClick={() => toggleLeg(p)}>{fmtOdds(p.odds)}</button>
                      </li>
                    );
                  })}
                </ul>
              ))}
            </div>
          </section>

          <section className="desk-panel p-3 lg:col-span-7">
            <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
              <div className="desk-label">My tickets ({tickets.length})</div>
              <div className="flex items-center gap-2">
                {updatedAt && <span className="desk-mono text-[10px] text-[hsl(var(--desk-muted))]">Updated {updatedAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>}
                <Button variant="ghost" size="icon" aria-label="Refresh live scores" onClick={() => call({ action: "live" })}><RefreshCw /></Button>
              </div>
            </div>
            <ul className="divide-y divide-[hsl(var(--desk-line))]">
              {tickets.map((t) => {
                const pnl = betPnl({ stake: t.stake, odds: t.odds } as PaperBet, t.status);
                const probs = t.legs.map((l) => legProb(l));
                const counted = probs.filter((p): p is number => p != null);
                const cash = t.status === "open" && !t.legs.some((l, i) => l.status === "open" && probs[i] == null) ? parlayCashProb(counted) : null;
                const openLegs = t.legs.filter((l) => l.status === "open");
                const last = openLegs.length === 1 ? openLegs[0] : null;
                const lastP = last ? legProb(last) ?? 0 : 0;
                const hOdds = Number(hedgeOdds[t.id] ?? "-110");
                const plan = last ? hedgePlan(t.stake, t.odds, hOdds, lastP) : null;
                const danger = t.legs.filter((l, i) => {
                  const probability = probs[i];
                  return l.status === "open" && probability != null && isDanger(probability, !!live[l.id]?.final);
                });
                return (
                  <li key={t.id} className="py-3 text-sm">
                    <div className="flex items-start justify-between gap-2">
                      <div className="desk-mono text-[11px] text-[hsl(var(--desk-muted))]">
                        {t.parlay ? `${t.legs.length}-LEG PARLAY` : "SINGLE"} · {t.date} · {fmt(t.stake)} at {fmtOdds(t.odds)}{t.book ? ` · ${t.book}` : ""}
                        <button className="ml-2 underline" onClick={() => confirm("Delete this ticket?") && call({ action: "delete", id: t.id })}>delete</button>
                      </div>
                      <div className="desk-mono shrink-0 text-right text-xs">
                        <div className={`uppercase font-bold ${t.status === "won" ? "text-[hsl(var(--desk-win))]" : t.status === "lost" ? "text-destructive" : ""}`}>{t.status}</div>
                        <div className={pnl > 0 ? "text-[hsl(var(--desk-amber))]" : pnl < 0 ? "text-destructive" : ""}>
                          {t.status === "open" ? `win ${fmt(winProfit(t.stake, t.odds))}` : fmt(pnl)}
                        </div>
                      </div>
                    </div>
                    {cash != null && (
                      <div className="desk-mono mt-1 flex flex-wrap items-center gap-2 text-[11px]">
                        <span>CASH CHANCE <b className="text-[hsl(var(--desk-amber))]">{Math.round(cash * 100)}%</b></span>
                        {danger.length > 0 && <span className="rounded bg-destructive/20 px-1.5 py-0.5 font-bold text-destructive">⚠ {danger.map((d) => d.player_name).join(", ")} in danger</span>}
                      </div>
                    )}
                    <ul className="mt-1 space-y-1">
                      {t.legs.map((l, li) => {
                        const lv = live[l.id];
                        const cur = l.status !== "open" ? l.result_value : lv?.value;
                        const line = Number(l.line);
                        const pct = cur == null ? 0 : Math.min(100, (Number(cur) / Math.max(line, 0.5)) * 100);
                        return (
                          <li key={l.id}>
                            <div className="flex items-center justify-between gap-2">
                              <span className="truncate">{l.player_name} {l.side === "over" ? "O" : "U"} {l.line} {statLabel(l.stat)}</span>
                              <span className="desk-mono shrink-0 text-[11px]">
                                {cur != null ? <b>{cur}</b> : "—"}
                                <span className="text-[hsl(var(--desk-muted))]"> · {l.status !== "open" ? l.status.toUpperCase() : lv ? lv.clock : "not started"}</span>
                                {l.status === "open" && <span className="text-[hsl(var(--desk-muted))]"> · {probs[li] == null ? "awaiting data" : `${Math.round(Number(probs[li]) * 100)}% est.`}</span>}
                              </span>
                            </div>
                            {cur != null && (
                              <div className="mt-0.5 h-1 overflow-hidden rounded bg-[hsl(var(--desk-line))]">
                                <div className="h-full bg-[hsl(var(--desk-amber))]" style={{ width: `${pct}%` }} />
                              </div>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                    {last && plan && (
                      <div className="mt-2 space-y-1 rounded-md border border-[hsl(var(--desk-line))] p-2 text-xs">
                        <div className="flex items-center justify-between gap-2">
                          <span className="desk-label">Hedge: {last.side === "over" ? "Under" : "Over"} {last.line} {statLabel(last.stat)}</span>
                          <label className="desk-mono flex items-center gap-1 text-[11px]">odds
                            <input value={hedgeOdds[t.id] ?? "-110"} onChange={(e) => setHedgeOdds((m) => ({ ...m, [t.id]: e.target.value }))}
                              className="w-16 rounded border border-[hsl(var(--desk-line))] bg-[hsl(var(--desk-bg))] px-1 py-0.5" />
                          </label>
                        </div>
                        <div className="desk-mono">
                          Bet <b>{fmt(plan.hedgeStake)}</b> → locks <b className={plan.lockedProfit >= 0 ? "text-[hsl(var(--desk-amber))]" : "text-destructive"}>{fmt(plan.lockedProfit)}</b> either way
                          <span className="text-[hsl(var(--desk-muted))]"> · {plan.recommended ? "hedge worth it" : plan.lockedProfit <= 0 ? "hedge loses money, ride or cut" : "leg looks good, optional"}</span>
                        </div>
                      </div>
                    )}
                    {t.status === "open" && (
                      <div className="mt-3 space-y-2 border-t border-[hsl(var(--desk-line))] pt-3">
                        <div className="desk-label">Live hedge analysis</div>
                        {openLegs.length > 1 && <p className="text-xs text-[hsl(var(--desk-muted))]">{openLegs.length} legs still open. No guaranteed hedge amount until one leg remains.</p>}
                        {cash == null && <p className="text-xs text-[hsl(var(--desk-muted))]">Win estimates await live scores and player history.</p>}
                        <Button variant="outline" size="sm" className="desk-tab text-xs" disabled={aiNote[t.id] === "Thinking…"} onClick={() => askAi(t, {
                          stake: t.stake, odds: t.odds, cash_chance: cash, hedge: plan,
                          legs: t.legs.map((l, i) => ({ player: l.player_name, stat: l.stat, side: l.side, line: l.line, status: l.status, now: live[l.id]?.value ?? null, minutes: live[l.id]?.minutes ?? null, clock: live[l.id]?.clock ?? "not started", win_prob: probs[i], ...pregame(l.player_name, l.stat) })),
                        })}>AI hedge note</Button>
                        {aiNote[t.id] && <p className="mt-1 whitespace-pre-wrap text-xs text-[hsl(var(--desk-muted))]">{aiNote[t.id]}</p>}
                      </div>
                    )}
                  </li>
                );
              })}
              {!tickets.length && <li className="py-3 text-sm text-[hsl(var(--desk-muted))]">No bets yet.</li>}
            </ul>
          </section>
        </div>
      </main>
    </div>
  );
}
