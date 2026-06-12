import { useState } from "react";
import {
  useSoccerSharpAlerts,
  useSoccerLineMovements,
  runSoccerSharpIngest,
  type SoccerSharpAlert,
} from "@/hooks/useSoccerSharpScanner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";

const CLASSIFICATION_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  LEAN: "secondary",
  STRONG: "default",
  HAMMER: "destructive",
  STEAM: "destructive",
};

const MARKET_LABEL: Record<string, string> = {
  moneyline: "Moneyline",
  asian_handicap: "Asian Handicap",
  totals: "Total",
  team_total_home: "Home Team Total",
  team_total_away: "Away Team Total",
};

const pct = (n: number) => `${n.toFixed(1)}%`;
const prob = (n: number) => `${(n * 100).toFixed(1)}%`;

function AlertRow({ a }: { a: SoccerSharpAlert }) {
  return (
    <TableRow>
      <TableCell className="font-medium">
        {a.home_team} vs {a.away_team}
        <div className="text-xs text-muted-foreground">{a.league}</div>
      </TableCell>
      <TableCell>
        {MARKET_LABEL[a.market] ?? a.market}
        {a.line != null && <span className="text-muted-foreground"> ({a.line})</span>}
      </TableCell>
      <TableCell>{prob(a.sharp_probability)}</TableCell>
      <TableCell>{prob(a.sportsbook_probability)}</TableCell>
      <TableCell className="font-mono text-emerald-500">+{pct(a.edge_percent)}</TableCell>
      <TableCell className="font-mono">{a.chess_score.toFixed(0)}</TableCell>
      <TableCell>
        <Badge variant={CLASSIFICATION_VARIANT[a.classification] ?? "outline"}>
          {a.classification}
        </Badge>
      </TableCell>
    </TableRow>
  );
}

export default function SoccerSharpScanner() {
  const alerts = useSoccerSharpAlerts();
  const movements = useSoccerLineMovements();
  const [running, setRunning] = useState(false);

  const trigger = async () => {
    setRunning(true);
    try {
      const res = await runSoccerSharpIngest();
      toast.success(`Ingest complete: ${JSON.stringify((res as any)?.stats ?? {})}`);
      alerts.refetch();
      movements.refetch();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setRunning(false);
    }
  };

  const data = alerts.data ?? [];
  const hammers = data.filter((a) => a.edge_percent > 6 && a.chess_score > 80);

  return (
    <div className="container mx-auto max-w-6xl py-6 space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Soccer Sharp Scanner</h1>
          <p className="text-sm text-muted-foreground">
            Pinnacle-anchored fair pricing vs HRB / DK / FD / Caesars / MGM
          </p>
        </div>
        <Button onClick={trigger} disabled={running}>
          {running ? "Scanning…" : "Run scan"}
        </Button>
      </header>

      <Card>
        <CardHeader><CardTitle>Today's Edges</CardTitle></CardHeader>
        <CardContent>
          {alerts.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : data.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No active edges. Hit "Run scan" once Pinnacle and book lines are available.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Match</TableHead>
                  <TableHead>Market</TableHead>
                  <TableHead>Sharp</TableHead>
                  <TableHead>Book</TableHead>
                  <TableHead>Edge</TableHead>
                  <TableHead>CHESS</TableHead>
                  <TableHead>Class</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((a) => <AlertRow key={a.id} a={a} />)}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Live Line Movement</CardTitle></CardHeader>
        <CardContent>
          {movements.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (movements.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No movement yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Book</TableHead>
                  <TableHead>Market</TableHead>
                  <TableHead>Side</TableHead>
                  <TableHead>Opening</TableHead>
                  <TableHead>Current</TableHead>
                  <TableHead>Delta</TableHead>
                  <TableHead>Direction</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(movements.data ?? []).map((m) => {
                  const delta = (m.current_line ?? 0) - (m.opening_line ?? 0);
                  return (
                    <TableRow key={m.id}>
                      <TableCell className="capitalize">{m.sportsbook}</TableCell>
                      <TableCell>{MARKET_LABEL[m.market_type] ?? m.market_type}</TableCell>
                      <TableCell>{m.side}</TableCell>
                      <TableCell>{m.opening_line ?? "—"}</TableCell>
                      <TableCell>{m.current_line ?? "—"}</TableCell>
                      <TableCell className="font-mono">{delta.toFixed(2)}</TableCell>
                      <TableCell>{delta > 0 ? "↑" : delta < 0 ? "↓" : "—"}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Hammer Candidates</CardTitle></CardHeader>
        <CardContent>
          {hammers.length === 0 ? (
            <p className="text-sm text-muted-foreground">No hammers right now.</p>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {hammers.map((h) => (
                <Card key={h.id} className="border-destructive/50">
                  <CardContent className="pt-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="font-semibold">{h.home_team} vs {h.away_team}</div>
                      <Badge variant="destructive">{h.classification}</Badge>
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {MARKET_LABEL[h.market] ?? h.market}
                      {h.line != null ? ` ${h.line}` : ""} · {h.sportsbook.toUpperCase()}
                    </div>
                    <div className="text-sm">
                      <span className="font-medium">Take:</span> {h.recommended_side}
                    </div>
                    <div className="flex gap-3 text-sm font-mono">
                      <span className="text-emerald-500">Edge +{pct(h.edge_percent)}</span>
                      <span>EV {h.expected_value != null ? (h.expected_value * 100).toFixed(1) + "%" : "—"}</span>
                      <span>CHESS {h.chess_score.toFixed(0)}</span>
                    </div>
                    {h.risk_flags?.length > 0 && (
                      <div className="flex gap-1 flex-wrap">
                        {h.risk_flags.map((f) => (
                          <Badge key={f} variant="outline" className="text-xs">{f}</Badge>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}