import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface Row {
  verdict: string;
  surface: string | null;
  tournament: string | null;
  edge_pct: number;
  line: number;
  actual_total_games: number | null;
  result: string | null;
  matchup: string | null;
  commence_at: string;
  suppressed?: boolean | null;
  suppressed_reason?: string | null;
  projection?: number | null;
  close_line?: number | null;
  clv_games?: number | null;
}

interface Bucket { label: string; wins: number; losses: number; pushes: number }

interface BiasRow { dimension: string; bucket: string; n: number; mean_residual: number | null; win_rate: number | null; clv_n: number | null; mean_clv: number | null }

function rate(b: Bucket): string {
  const decided = b.wins + b.losses;
  if (decided === 0) return "—";
  return ((100 * b.wins) / decided).toFixed(1) + "%";
}

function roiUnits(b: Bucket): string {
  // Assume -110 odds → win +0.909u, loss -1u
  const profit = b.wins * 0.909 - b.losses;
  const staked = b.wins + b.losses;
  if (staked === 0) return "—";
  return ((100 * profit) / staked).toFixed(1) + "%";
}

function bucketBy(rows: Row[], key: (r: Row) => string): Bucket[] {
  const map = new Map<string, Bucket>();
  for (const r of rows) {
    const k = key(r);
    const b = map.get(k) ?? { label: k, wins: 0, losses: 0, pushes: 0 };
    if (r.result === "WIN") b.wins++;
    else if (r.result === "LOSS") b.losses++;
    else if (r.result === "PUSH") b.pushes++;
    map.set(k, b);
  }
  return Array.from(map.values()).sort((a, b) => (b.wins + b.losses) - (a.wins + a.losses));
}

function edgeBucket(pct: number): string {
  const a = Math.abs(pct);
  if (a >= 15) return "15%+";
  if (a >= 10) return "10–15%";
  if (a >= 7) return "7–10%";
  return "<7%";
}

function tierFromTournament(t: string | null): string {
  if (!t) return "unknown";
  const s = t.toLowerCase();
  if (/roland|wimbledon|us open|australian|melbourne|flushing/.test(s)) return "grand_slam";
  if (/madrid|miami|indian wells|cincinnati|rome|monte carlo|shanghai|paris masters|toronto|montreal|masters 1000|wta 1000/.test(s)) return "masters_1000";
  if (/atp 500|wta 500|dubai|barcelona|vienna|basel|rotterdam|queens|halle|hamburg|tokyo|beijing|doha/.test(s)) return "500";
  if (/challenger|atp 125|atp 100|atp 75/.test(s)) return "challenger";
  if (/itf|m15|m25|w15|w25|w35|w50|w60|w75|w100/.test(s)) return "itf";
  return "250/other";
}

export default function CourtEdgeAccuracy() {
  const [rows, setRows] = useState<Row[]>([]);
  const [bias, setBias] = useState<BiasRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [settling, setSettling] = useState(false);
  const [diffing, setDiffing] = useState(false);
  const [diffResult, setDiffResult] = useState<any>(null);

  async function load() {
    setLoading(true);
    const [{ data, error }, biasRes] = await Promise.all([
      supabase
      .from("court_edge_picks")
      .select("verdict,surface,tournament,edge_pct,line,actual_total_games,result,matchup,commence_at,suppressed,suppressed_reason,projection,close_line,clv_games")
      .eq("graded", true)
      .in("verdict", ["STRONG_OVER", "STRONG_UNDER", "LEAN_OVER", "LEAN_UNDER"])
      .order("commence_at", { ascending: false })
      .limit(1000),
      supabase.from("projection_bias_audit").select("*"),
    ]);
    if (error) console.error(error);
    if (biasRes.error) console.error(biasRes.error);
    setRows((data as Row[]) || []);
    setBias(((biasRes.data as BiasRow[]) || []).sort((a, b) =>
      Math.abs(Number(b.mean_residual ?? 0)) - Math.abs(Number(a.mean_residual ?? 0))
    ));
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function runSettle() {
    setSettling(true);
    try {
      const { data, error } = await supabase.functions.invoke("court-edge-settle", { body: { limit: 200 } });
      if (error) console.error(error);
      else console.log("settle result", data);
      await load();
    } finally { setSettling(false); }
  }

  async function runParserDiff() {
    setDiffing(true);
    setDiffResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("court-edge-parser-diff", { body: { limit: 400 } });
      if (error) console.error(error);
      setDiffResult(data ?? { error: error?.message });
    } finally { setDiffing(false); }
  }

  // v1 = legacy (all graded), v2 = excludes suppressed STRONG_OVER
  const tallyRow = (r: Row, b: Bucket) => {
    if (r.result === "WIN") b.wins++;
    else if (r.result === "LOSS") b.losses++;
    else if (r.result === "PUSH") b.pushes++;
  };
  const v1: Bucket = { label: "v1", wins: 0, losses: 0, pushes: 0 };
  const v2: Bucket = { label: "v2", wins: 0, losses: 0, pushes: 0 };
  for (const r of rows) {
    tallyRow(r, v1);
    if (!r.suppressed) tallyRow(r, v2);
  }

  const liveRows = rows.filter((r) => !r.suppressed);
  const suppressedRows = rows.filter((r) => r.suppressed);

  const byVerdict = bucketBy(liveRows, (r) => r.verdict);
  const bySurface = bucketBy(liveRows, (r) => r.surface ?? "unknown");
  const byTier = bucketBy(liveRows, (r) => tierFromTournament(r.tournament));
  const byEdge = bucketBy(liveRows, (r) => edgeBucket(Number(r.edge_pct)));

  const Section = ({ title, buckets }: { title: string; buckets: Bucket[] }) => (
    <Card className="p-4">
      <h3 className="text-sm font-semibold mb-3 text-muted-foreground uppercase tracking-wide">{title}</h3>
      <table className="w-full text-sm">
        <thead className="text-xs text-muted-foreground">
          <tr><th className="text-left py-1">Bucket</th><th className="text-right">W</th><th className="text-right">L</th><th className="text-right">P</th><th className="text-right">Hit</th><th className="text-right">ROI</th></tr>
        </thead>
        <tbody>
          {buckets.map((b) => {
            const r = rate(b);
            const decided = b.wins + b.losses;
            const hitNum = decided > 0 ? (100 * b.wins) / decided : 0;
            const cls = decided < 10 ? "text-muted-foreground"
              : hitNum >= 55 ? "text-green-500"
              : hitNum >= 50 ? "text-foreground"
              : "text-red-500";
            return (
              <tr key={b.label} className="border-t border-border/40">
                <td className="py-1.5 font-mono">{b.label}</td>
                <td className="text-right">{b.wins}</td>
                <td className="text-right">{b.losses}</td>
                <td className="text-right">{b.pushes}</td>
                <td className={`text-right font-semibold ${cls}`}>{r}</td>
                <td className="text-right text-xs">{roiUnits(b)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );

  return (
    <div className="p-6 space-y-4 max-w-6xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Court.Edge Accuracy</h1>
          <p className="text-sm text-muted-foreground">Graded tennis picks · ROI assumes -110 · v2 excludes suppressed STRONG_OVER.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={load} disabled={loading}>Refresh</Button>
          <Button onClick={runSettle} disabled={settling}>{settling ? "Settling…" : "Run settle now"}</Button>
          <Button variant="secondary" onClick={runParserDiff} disabled={diffing}>{diffing ? "Diffing…" : "Run parser diff"}</Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {[v1, v2].map((t, i) => (
          <Card key={i} className="p-4">
            <div className="text-xs text-muted-foreground uppercase mb-2">
              {i === 0 ? "v1 · Legacy (all graded)" : "v2 · Excludes suppressed STRONG_OVER"}
            </div>
            <div className="flex items-center gap-6">
              <div>
                <div className="text-[10px] text-muted-foreground uppercase">Sample</div>
                <div className="text-2xl font-bold">{t.wins + t.losses + t.pushes}</div>
              </div>
              <div>
                <div className="text-[10px] text-muted-foreground uppercase">W–L</div>
                <div className="text-2xl font-bold">{t.wins}–{t.losses}<span className="text-xs text-muted-foreground ml-2">({t.pushes}p)</span></div>
              </div>
              <div>
                <div className="text-[10px] text-muted-foreground uppercase">Hit</div>
                <div className="text-2xl font-bold">{rate(t)}</div>
              </div>
              <div>
                <div className="text-[10px] text-muted-foreground uppercase">ROI</div>
                <div className="text-2xl font-bold">{roiUnits(t)}</div>
              </div>
            </div>
          </Card>
        ))}
      </div>

      {diffResult && (
        <Card className="p-4">
          <h3 className="text-sm font-semibold mb-2 text-muted-foreground uppercase tracking-wide">Parser diff</h3>
          <pre className="text-xs whitespace-pre-wrap overflow-x-auto">{JSON.stringify(diffResult, null, 2)}</pre>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Section title="By Verdict" buckets={byVerdict} />
        <Section title="By Edge magnitude" buckets={byEdge} />
        <Section title="By Surface" buckets={bySurface} />
        <Section title="By Tournament tier" buckets={byTier} />
      </div>

      <Card className="p-4">
        <h3 className="text-sm font-semibold mb-3 text-muted-foreground uppercase tracking-wide">
          Projection bias (mean residual = projection − actual)
        </h3>
        <p className="text-xs text-muted-foreground mb-3">Positive residual = projection too high. Red = ≥+0.4 games with n ≥ 30 — candidate multiplier to dial back.</p>
        <table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground">
            <tr>
              <th className="text-left py-1">Dimension</th>
              <th className="text-left">Bucket</th>
              <th className="text-right">n</th>
              <th className="text-right">Mean residual</th>
              <th className="text-right">Win rate</th>
              <th className="text-right">CLV n</th>
              <th className="text-right">Mean CLV</th>
            </tr>
          </thead>
          <tbody>
            {bias.map((b, i) => {
              const r = Number(b.mean_residual ?? 0);
              const flag = r > 0.4 && b.n >= 30 ? "text-red-500 font-semibold"
                : r < -0.4 && b.n >= 30 ? "text-green-500 font-semibold"
                : "";
              const clv = Number(b.mean_clv ?? 0);
              const clvN = Number(b.clv_n ?? 0);
              const clvCls = clvN < 10 ? "text-muted-foreground"
                : clv > 0.2 ? "text-green-500 font-semibold"
                : clv < -0.2 ? "text-red-500 font-semibold"
                : "";
              return (
                <tr key={i} className="border-t border-border/40">
                  <td className="py-1 font-mono text-xs">{b.dimension}</td>
                  <td className="font-mono text-xs">{b.bucket}</td>
                  <td className="text-right">{b.n}</td>
                  <td className={`text-right ${flag}`}>{r > 0 ? "+" : ""}{r.toFixed(2)}</td>
                  <td className="text-right">{b.win_rate == null ? "—" : `${b.win_rate}%`}</td>
                  <td className="text-right text-muted-foreground">{b.clv_n ?? 0}</td>
                  <td className={`text-right ${clvCls}`}>{b.mean_clv == null ? "—" : `${clv > 0 ? "+" : ""}${clv.toFixed(2)}`}</td>
                </tr>
              );
            })}
            {bias.length === 0 && (
              <tr><td colSpan={7} className="text-center text-muted-foreground py-4 text-xs">No bias data yet.</td></tr>
            )}
          </tbody>
        </table>
      </Card>

      <Card className="p-4">
        <h3 className="text-sm font-semibold mb-3 text-muted-foreground uppercase tracking-wide">
          Suppressed picks ({suppressedRows.length} graded)
        </h3>
        <p className="text-xs text-muted-foreground mb-3">Hidden from broadcast + headline ROI. Still graded so we can monitor whether the suppression decision was correct.</p>
        <table className="w-full text-xs">
          <thead className="text-muted-foreground">
            <tr>
              <th className="text-left py-1">Match</th>
              <th>Reason</th>
              <th>Line</th>
              <th>Proj</th>
              <th>Actual</th>
              <th>Would-be</th>
            </tr>
          </thead>
          <tbody>
            {suppressedRows.slice(0, 15).map((r, i) => (
              <tr key={i} className="border-t border-border/40">
                <td className="py-1 truncate max-w-[260px]">{r.matchup}</td>
                <td className="text-center font-mono text-[10px]">{r.suppressed_reason}</td>
                <td className="text-center">{r.line}</td>
                <td className="text-center">{r.projection?.toFixed?.(1) ?? "—"}</td>
                <td className="text-center">{r.actual_total_games ?? "—"}</td>
                <td className="text-center">
                  <Badge className={r.result === "WIN" ? "bg-green-600" : r.result === "LOSS" ? "bg-red-600" : "bg-muted"}>
                    {r.result}
                  </Badge>
                </td>
              </tr>
            ))}
            {suppressedRows.length === 0 && (
              <tr><td colSpan={6} className="text-center text-muted-foreground py-4">No suppressed picks yet.</td></tr>
            )}
          </tbody>
        </table>
      </Card>

      <Card className="p-4">
        <h3 className="text-sm font-semibold mb-3 text-muted-foreground uppercase tracking-wide">Last 25 graded</h3>
        <table className="w-full text-xs">
          <thead className="text-muted-foreground">
            <tr>
              <th className="text-left py-1">Match</th>
              <th>Verdict</th>
              <th>Line</th>
              <th>Actual</th>
              <th>Edge</th>
              <th>CLV</th>
              <th>Result</th>
            </tr>
          </thead>
          <tbody>
            {liveRows.slice(0, 25).map((r, i) => (
              <tr key={i} className="border-t border-border/40">
                <td className="py-1 truncate max-w-[260px]">{r.matchup}</td>
                <td className="text-center"><Badge variant="outline" className="text-[10px]">{r.verdict.replace("_", " ")}</Badge></td>
                <td className="text-center">{r.line}</td>
                <td className="text-center">{r.actual_total_games ?? "—"}</td>
                <td className="text-center">{Number(r.edge_pct).toFixed(1)}</td>
                <td className={`text-center ${r.clv_games == null ? "text-muted-foreground" : Number(r.clv_games) > 0 ? "text-green-500" : Number(r.clv_games) < 0 ? "text-red-500" : ""}`}>
                  {r.clv_games == null ? "—" : `${Number(r.clv_games) > 0 ? "+" : ""}${Number(r.clv_games).toFixed(1)}`}
                </td>
                <td className="text-center">
                  <Badge className={r.result === "WIN" ? "bg-green-600" : r.result === "LOSS" ? "bg-red-600" : "bg-muted"}>
                    {r.result}
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}