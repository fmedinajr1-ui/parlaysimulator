import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import "@/components/desk/desk-tokens.css";
import { STAT_OPTIONS, useResearchData } from "@/hooks/useResearchData";
import { supabase } from "@/integrations/supabase/client";
import { PASS_KEY } from "@/components/AdminGate";
import type { BetStatus } from "@/utils/paperBets";
import { betPnl, settleBet, summarize, winProfit, type PaperBet, type Side } from "@/utils/paperBets";
import type { StatKey } from "@/utils/nbaBoxScoreMath";

const fmt = (n: number) => `${n < 0 ? "-" : ""}$${Math.abs(n).toFixed(2)}`;
const fmtOdds = (o: number) => (o > 0 ? `+${o}` : String(o));

export default function PaperBets({ mode = "paper" }: { mode?: "paper" | "real" }) {
  const real = mode === "real";
  const BETS_KEY = real ? "real_bets_v1" : "paper_bets_v1", BANK_KEY = real ? "real_bankroll_v1" : "paper_bankroll_v1";
  const [book, setBook] = useState(() => localStorage.getItem("real_last_book") || "FanDuel");
  const { byPlayer, propLines, lineOdds, tonight, today, logs, loading } = useResearchData();
  const [bets, setBets] = useState<PaperBet[]>(() => (real ? [] : JSON.parse(localStorage.getItem(BETS_KEY) || "[]")));
  const [start, setStart] = useState<number>(() => Number(localStorage.getItem(BANK_KEY)) || 0);
  const [bankInput, setBankInput] = useState("");
  const [q, setQ] = useState("");
  const [pick, setPick] = useState<{ player: string; stat: StatKey; line: number; side: Side; odds: number } | null>(null);
  const [stake, setStake] = useState("");

  const [serverStatus, setServerStatus] = useState<Map<string, BetStatus>>(new Map());
  const [syncErr, setSyncErr] = useState("");
  useEffect(() => { if (!real) localStorage.setItem(BETS_KEY, JSON.stringify(bets)); }, [bets, real]);

  // Real bets live on the server so the 10 AM update can grade them.
  const call = async (body: Record<string, unknown>) => {
    const { data, error } = await supabase.functions.invoke("desk-bets", { body: { passcode: localStorage.getItem(PASS_KEY) ?? "", ...body } });
    if (error || !data?.bets) { setSyncErr("Couldn't reach your saved bets. Try again."); return; }
    setSyncErr("");
    type Row = { id: string; player_name: string; stat: StatKey; side: Side; line: number; odds: number; stake: number; book: string | null; game_date: string; placed_at: string; status: BetStatus };
    const rows = data.bets as Row[];
    setBets(rows.map((r) => ({ id: r.id, player: r.player_name, stat: r.stat, side: r.side, line: Number(r.line), odds: r.odds, stake: Number(r.stake), book: r.book ?? undefined, gameDate: r.game_date, placedAt: r.placed_at })));
    setServerStatus(new Map(rows.map((r) => [r.id, r.status])));
  };
  const toRow = (b: PaperBet) => ({ player_name: b.player, stat: b.stat, side: b.side, line: b.line, odds: b.odds, stake: b.stake, book: b.book ?? null, game_date: b.gameDate, placed_at: b.placedAt });
  useEffect(() => {
    if (!real) return;
    // One-time move of bets logged on this device before they were saved online.
    const local: PaperBet[] = JSON.parse(localStorage.getItem(BETS_KEY) || "[]");
    if (local.length) call({ action: "add", bets: local.map(toRow) }).then(() => localStorage.removeItem(BETS_KEY));
    else call({ action: "list" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [real]);
  useEffect(() => localStorage.setItem(BANK_KEY, String(start)), [start]);

  const props = useMemo(() => {
    const out: { player: string; stat: StatKey; line: number; over: number; under: number; opp: string | null }[] = [];
    for (const [k, line] of propLines) {
      const [lower, stat] = k.split("|");
      const player = [...byPlayer.keys()].find((n) => n.toLowerCase() === lower) ?? lower.replace(/\b[a-z]/g, (c) => c.toUpperCase());
      const o = lineOdds.get(k);
      out.push({ player, stat: stat as StatKey, line, over: o?.over ?? -110, under: o?.under ?? -110, opp: tonight.get(lower) ?? null });
    }
    const f = q.trim().toLowerCase();
    return out.filter((p) => !f || p.player.toLowerCase().includes(f)).sort((a, b) => a.player.localeCompare(b.player));
  }, [propLines, lineOdds, byPlayer, tonight, q]);

  const graded = useMemo(() => {
    return bets.map((bet) => ({ bet, status: serverStatus.get(bet.id) && serverStatus.get(bet.id) !== "open" ? serverStatus.get(bet.id)! : settleBet(bet, [...byPlayer].find(([n]) => n.toLowerCase() === bet.player.toLowerCase())?.[1] ?? []) }));
  }, [bets, byPlayer, serverStatus]);
  const sum = summarize(start, graded);
  const stakeNum = Number(stake);
  const canPlace = pick && stakeNum > 0 && pick.odds !== 0 && Math.abs(pick.odds) >= 100 && (real || (start > 0 && stakeNum <= sum.bankroll));

  const place = () => {
    if (!pick || !canPlace) return;
    const nb: PaperBet = { id: crypto.randomUUID(), ...pick, stake: stakeNum, gameDate: today, ...(real ? { book } : {}), placedAt: new Date().toISOString() };
    if (real) call({ action: "add", bets: [toRow(nb)] });
    else setBets((b) => [nb, ...b]);
    if (real) localStorage.setItem("real_last_book", book);
    setPick(null);
    setStake("");
  };
  const statLabel = (s: StatKey) => STAT_OPTIONS.find((o) => o.key === s)?.label ?? s;

  return (
    <div className="desk-theme desk-grid-bg min-h-screen">
      <header className="sticky top-0 z-30 border-b border-[hsl(var(--desk-line))] bg-[hsl(var(--desk-bg)/0.9)] px-3 py-3 backdrop-blur sm:px-4">
        <div className="mx-auto flex max-w-[1100px] items-center justify-between gap-3 pr-14 sm:pr-0">
          <div>
            <div className="desk-display text-lg font-bold">{real ? "My sportsbook" : "Paper bets"}</div>
            <div className="desk-label mt-1">{real ? "Log bets you placed · settles from box scores" : "Pretend money · tonight's lines · settles from box scores"}</div>
          </div>
          <div className="flex gap-1">
            <Link to={real ? "/paper" : "/bets"} className="desk-tab">{real ? "Paper" : "Real bets"}</Link>
            <Link to="/" className="desk-tab">← Desk</Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1100px] space-y-3 px-3 pb-16 pt-3 sm:px-4">
        <section className="desk-panel grid grid-cols-2 gap-3 p-3 sm:grid-cols-4">
          {[
            ["Bankroll", fmt(sum.bankroll)],
            ["Profit", fmt(sum.profit)],
            ["Open stakes", fmt(sum.atRisk)],
            ["Record", `${sum.won}-${sum.lost}`],
          ].map(([l, v], i) => (
            <div key={l}>
              <div className="desk-label">{l}</div>
              <div className={`desk-mono text-lg font-semibold ${i === 1 ? (sum.profit >= 0 ? "text-[hsl(var(--desk-amber))]" : "text-destructive") : ""}`}>{v}</div>
            </div>
          ))}
          <div className="col-span-2 flex flex-wrap items-center gap-2 sm:col-span-4">
            <input
              inputMode="decimal"
              placeholder={start ? `Starting money: ${fmt(start)}` : real ? "Your bankroll (optional), e.g. 500" : "Set your starting money, e.g. 500"}
              value={bankInput}
              onChange={(e) => setBankInput(e.target.value.replace(/[^\d.]/g, ""))}
              className="min-w-0 flex-1 rounded-md border border-[hsl(var(--desk-line))] bg-[hsl(var(--desk-bg))] px-3 py-2 text-sm"
            />
            <button className="desk-tab" data-active="true" onClick={() => { const n = Number(bankInput); if (n > 0) { setStart(n); setBankInput(""); } }}>
              {start ? "Change" : "Set"}
            </button>
            {syncErr && <p className="w-full text-sm text-destructive">{syncErr}</p>}
            {!real && bets.length > 0 && (
              <button className="desk-tab" onClick={() => confirm(real ? "Clear all logged bets?" : "Clear all paper bets?") && setBets([])}>Reset bets</button>
            )}
          </div>
        </section>

        <div className="grid gap-3 lg:grid-cols-12">
          <section className="desk-panel p-3 lg:col-span-7">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="desk-label">Tonight's props ({props.length})</div>
              <input placeholder="Search player" value={q} onChange={(e) => setQ(e.target.value)}
                className="w-40 rounded-md border border-[hsl(var(--desk-line))] bg-[hsl(var(--desk-bg))] px-2 py-1.5 text-sm" />
            </div>
            {loading && !props.length ? (
              <p className="desk-mono text-sm text-[hsl(var(--desk-muted))]">Loading…</p>
            ) : !props.length ? (
              <p className="desk-mono text-sm text-[hsl(var(--desk-muted))]">No lines loaded for tonight yet. They arrive with the 10 AM update.</p>
            ) : (
              <ul className="max-h-[60vh] divide-y divide-[hsl(var(--desk-line))] overflow-y-auto">
                {props.map((p) => (
                  <li key={`${p.player}|${p.stat}`} className="flex items-center justify-between gap-2 py-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold">{p.player}</div>
                      <div className="desk-mono text-[11px] text-[hsl(var(--desk-muted))]">
                        {statLabel(p.stat)} {p.line}{p.opp ? ` · vs ${p.opp}` : ""}
                      </div>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      {(["over", "under"] as Side[]).map((side) => {
                        const odds = side === "over" ? p.over : p.under;
                        const active = pick?.player === p.player && pick.stat === p.stat && pick.side === side;
                        return (
                          <button key={side} className="desk-tab desk-mono text-xs" data-active={active}
                            onClick={() => setPick({ player: p.player, stat: p.stat, line: p.line, side, odds })}>
                            {side === "over" ? "O" : "U"} {fmtOdds(odds)}
                          </button>
                        );
                      })}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="desk-panel space-y-2 p-3 lg:col-span-5">
            <div className="desk-label">Bet slip</div>
            {!pick ? (
              <p className="text-sm text-[hsl(var(--desk-muted))]">Tap Over or Under on a prop.</p>
            ) : (
              <>
                <div className="text-sm">
                  <b>{pick.player}</b> {pick.side === "over" ? "Over" : "Under"} {pick.line} {statLabel(pick.stat)}{" "}
                  <span className="desk-mono">({fmtOdds(pick.odds)})</span>
                </div>
                {real && (
                  <div key={`${pick.player}|${pick.stat}|${pick.side}`} className="grid grid-cols-3 gap-2">
                    {[
                      ["Line", String(pick.line), (v: string) => setPick({ ...pick, line: Number(v) || 0 })],
                      ["Odds", String(pick.odds), (v: string) => setPick({ ...pick, odds: Number(v) || 0 })],
                      ["Book", book, setBook],
                    ].map(([l, v, on]) => (
                      <label key={l as string} className="desk-label">{l as string}
                        <input defaultValue={v as string} onChange={(e) => (on as (v: string) => void)(e.target.value)}
                          className="mt-1 w-full rounded-md border border-[hsl(var(--desk-line))] bg-[hsl(var(--desk-bg))] px-2 py-1.5 text-sm normal-case" />
                      </label>
                    ))}
                  </div>
                )}
                <input inputMode="decimal" placeholder="Stake $" value={stake}
                  onChange={(e) => setStake(e.target.value.replace(/[^\d.]/g, ""))}
                  className="w-full rounded-md border border-[hsl(var(--desk-line))] bg-[hsl(var(--desk-bg))] px-3 py-2 text-sm" />
                <div className="desk-mono text-xs text-[hsl(var(--desk-muted))]">
                  To win {fmt(winProfit(stakeNum || 0, pick.odds))}
                  {real ? "" : !start ? " · set your starting money first" : stakeNum > sum.bankroll ? " · more than your bankroll" : ""}
                </div>
                <button disabled={!canPlace} onClick={place}
                  className="w-full rounded-md bg-[hsl(var(--desk-amber))] py-2 text-sm font-bold text-[hsl(var(--desk-bg))] disabled:opacity-40">
                  {real ? "Log this bet" : "Place paper bet"}
                </button>
              </>
            )}

            <div className="desk-label pt-3">My bets ({bets.length})</div>
            <ul className="divide-y divide-[hsl(var(--desk-line))]">
              {graded.map(({ bet, status }) => {
                const pnl = betPnl(bet, status);
                return (
                  <li key={bet.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                    <div className="min-w-0">
                      <div className="truncate">{bet.player} {bet.side === "over" ? "O" : "U"} {bet.line} {statLabel(bet.stat)}</div>
                      <div className="desk-mono text-[11px] text-[hsl(var(--desk-muted))]">{bet.gameDate} · {fmt(bet.stake)} at {fmtOdds(bet.odds)}{bet.book ? ` · ${bet.book}` : ""}
                        {real && <button className="ml-2 underline" onClick={() => confirm("Delete this bet?") && call({ action: "delete", id: bet.id })}>delete</button>}</div>
                    </div>
                    <div className="desk-mono shrink-0 text-right text-xs">
                      <div className="uppercase">{status}</div>
                      <div className={pnl > 0 ? "text-[hsl(var(--desk-amber))]" : pnl < 0 ? "text-destructive" : ""}>
                        {status === "open" ? `win ${fmt(winProfit(bet.stake, bet.odds))}` : fmt(pnl)}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        </div>
      </main>
    </div>
  );
}
