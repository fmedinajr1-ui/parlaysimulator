import { format } from "date-fns";
import { CalendarIcon, Database, RefreshCw, Search, ShieldAlert, Target, Wifi } from "lucide-react";
import { Navigate } from "react-router-dom";
import { useMemo } from "react";

import { AppShell } from "@/components/layout/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAdminRole } from "@/hooks/useAdminRole";
import { type DiagnosticsRow, useBotLegDiagnostics } from "@/hooks/useBotLegDiagnostics";
import { cn } from "@/lib/utils";

function formatDateLabel(date: string) {
  try {
    return format(new Date(`${date}T12:00:00`), "PPP");
  } catch {
    return date;
  }
}

function formatValue(value: unknown) {
  if (value == null || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return Number.isInteger(value) ? `${value}` : value.toFixed(2);
  return String(value);
}

function statusTone(status?: string | null) {
  switch (status) {
    case "matched_fresh":
      return "bg-primary/10 text-primary border-primary/20";
    case "matched_stale":
      return "bg-secondary text-secondary-foreground border-border";
    case "matched_line_moved":
    case "matched_missing_price":
    case "matched_inactive":
    case "no_book_match":
      return "bg-destructive/10 text-destructive border-destructive/20";
    default:
      return "bg-muted text-muted-foreground border-border";
  }
}

function SummaryMetric({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-lg border border-border/60 bg-muted/20 p-4">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-2 text-2xl font-semibold text-foreground">{value}</div>
      {hint ? <div className="mt-1 text-xs text-muted-foreground">{hint}</div> : null}
    </div>
  );
}

function BreakdownChips({ items }: { items: Array<{ label: string; count: number }> }) {
  if (!items.length) return <div className="text-sm text-muted-foreground">No blockers recorded.</div>;

  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item) => (
        <Badge key={item.label} variant="outline" className="rounded-md px-2.5 py-1 text-xs">
          {item.label} · {item.count}
        </Badge>
      ))}
    </div>
  );
}

function DataTable({ rows, columns, emptyMessage }: { rows: DiagnosticsRow[]; columns: Array<{ key: string; label: string }>; emptyMessage: string }) {
  if (!rows.length) {
    return <div className="rounded-lg border border-dashed border-border/70 p-6 text-sm text-muted-foreground">{emptyMessage}</div>;
  }

  return (
    <ScrollArea className="w-full rounded-lg border border-border/60">
      <Table>
        <TableHeader>
          <TableRow>
            {columns.map((column) => (
              <TableHead key={column.key} className="whitespace-nowrap">{column.label}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, index) => (
            <TableRow key={String(row.id ?? `${index}-${row.player_name ?? row.bookmaker ?? "row"}`)}>
              {columns.map((column) => {
                const value = row[column.key];
                if (column.key === "status") {
                  return (
                    <TableCell key={column.key}>
                      <Badge variant="outline" className={cn("rounded-md border", statusTone(typeof value === "string" ? value : null))}>
                        {formatValue(value)}
                      </Badge>
                    </TableCell>
                  );
                }

                return <TableCell key={column.key}>{formatValue(value)}</TableCell>;
              })}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </ScrollArea>
  );
}

function LoadingState() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-32 w-full rounded-xl" />
      <Skeleton className="h-72 w-full rounded-xl" />
      <Skeleton className="h-72 w-full rounded-xl" />
    </div>
  );
}

export default function BotLegDiagnostics() {
  const { isAdmin, isLoading: adminLoading } = useAdminRole();
  const {
    date,
    setDate,
    bookmaker,
    setBookmaker,
    playerSearch,
    setPlayerSearch,
    failedOnly,
    setFailedOnly,
    bookmakerOptions,
    data,
    isLoading,
    isFetching,
    error,
    refetch,
  } = useBotLegDiagnostics();

  const dateValue = useMemo(() => new Date(`${date}T12:00:00`), [date]);

  if (adminLoading) {
    return <AppShell><LoadingState /></AppShell>;
  }

  if (!isAdmin) {
    return <Navigate to="/" replace />;
  }

  return (
    <AppShell>
      <div className="space-y-6 pb-16">
        <section className="rounded-lg border border-border bg-card">
          <div className="flex flex-col gap-4 p-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <ShieldAlert className="h-4 w-4" />
                admin diagnostics
              </div>
              <h1 className="text-3xl font-semibold text-foreground">Leg production diagnostics</h1>
              <p className="max-w-3xl text-sm text-muted-foreground">
                See the first engine output, what the pool is giving, whether books are scanning, and which legs are failing before parlays or straights can build.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" onClick={() => refetch()} disabled={isFetching}>
                <RefreshCw className={cn("h-4 w-4", isFetching && "animate-spin")} />
                Refresh
              </Button>
            </div>
          </div>

          <div className="grid gap-3 border-t border-border/60 p-6 md:grid-cols-2 xl:grid-cols-5">
            <div className="space-y-2 xl:col-span-1">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Date</div>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-full justify-start">
                    <CalendarIcon className="h-4 w-4" />
                    {formatDateLabel(date)}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={dateValue}
                    onSelect={(selected) => {
                      if (!selected) return;
                      setDate(format(selected, "yyyy-MM-dd"));
                    }}
                    initialFocus
                    className={cn("p-3 pointer-events-auto")}
                  />
                </PopoverContent>
              </Popover>
            </div>

            <div className="space-y-2">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Bookmaker</div>
              <Select value={bookmaker} onValueChange={setBookmaker}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose book" />
                </SelectTrigger>
                <SelectContent>
                  {bookmakerOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2 md:col-span-2 xl:col-span-2">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Player search</div>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input value={playerSearch} onChange={(e) => setPlayerSearch(e.target.value)} placeholder="Search player name" className="pl-9" />
              </div>
            </div>

            <div className="flex items-center gap-3 rounded-lg border border-border/60 bg-muted/20 px-4 py-3 xl:self-end">
              <Checkbox id="failed-only" checked={failedOnly} onCheckedChange={(checked) => setFailedOnly(checked === true)} />
              <label htmlFor="failed-only" className="text-sm text-foreground">Show failed matches only</label>
            </div>
          </div>
        </section>

        {isLoading ? <LoadingState /> : null}

        {error ? (
          <Card>
            <CardHeader>
              <CardTitle>Diagnostics unavailable</CardTitle>
              <CardDescription>{error instanceof Error ? error.message : "Unknown error"}</CardDescription>
            </CardHeader>
          </Card>
        ) : null}

        {data ? (
          <>
            <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <SummaryMetric label="First engine approved" value={data.summary.risk_rows_approved} hint={`${data.summary.risk_rows_rejected} rejected`} />
              <SummaryMetric label="Pool rows" value={data.summary.pool_rows_total} hint={data.pick_pool.status} />
              <SummaryMetric label="Fresh matched legs" value={data.summary.matched_fresh_rows} hint={`${data.summary.pool_rows_failing} failing`} />
              <SummaryMetric label="Books scanning" value={data.summary.scanning_books ? "Yes" : "No"} hint={data.summary.final_reason ?? "No final reason"} />
            </section>

            <section className="grid gap-4 xl:grid-cols-[1.25fr_1fr]">
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <CardTitle className="flex items-center gap-2 text-xl"><Target className="h-5 w-5" /> First engine</CardTitle>
                      <CardDescription>{data.engine_start.engine_name}</CardDescription>
                    </div>
                    <Badge variant="outline">{data.engine_start.approved_count} approved</Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <BreakdownChips items={data.engine_start.top_rejection_reasons} />
                  <DataTable
                    rows={data.engine_start.approved_rows}
                    emptyMessage="No approved risk rows for this date."
                    columns={[
                      { key: "player_name", label: "Player" },
                      { key: "prop_type", label: "Prop" },
                      { key: "side", label: "Side" },
                      { key: "line", label: "Line" },
                      { key: "confidence_score", label: "Conf" },
                      { key: "edge", label: "Edge" },
                      { key: "l10_hit_rate", label: "L10 HR" },
                    ]}
                  />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <CardTitle className="flex items-center gap-2 text-xl"><Database className="h-5 w-5" /> Pool output</CardTitle>
                      <CardDescription>What the builder is currently feeding downstream.</CardDescription>
                    </div>
                    <Badge variant="outline">{data.pick_pool.status}</Badge>
                  </div>
                  <div className="text-xs text-muted-foreground">Showing {Math.min(data.pick_pool.rows.length, 120)} of {data.pick_pool.rows.length} pool rows</div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <BreakdownChips items={data.pick_pool.blocker_breakdown} />
                  <DataTable
                    rows={data.pick_pool.rows.slice(0, 120)}
                    emptyMessage="No pool rows for this date."
                    columns={[
                      { key: "player_name", label: "Player" },
                      { key: "prop_type", label: "Prop" },
                      { key: "recommended_side", label: "Side" },
                      { key: "recommended_line", label: "Line" },
                      { key: "composite_score", label: "Score" },
                      { key: "status", label: "Status" },
                      { key: "failure_reason", label: "Reason" },
                    ]}
                  />
                </CardContent>
              </Card>
            </section>

            <section className="grid gap-4 xl:grid-cols-[1.1fr_1fr]">
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <CardTitle className="flex items-center gap-2 text-xl"><Wifi className="h-5 w-5" /> Book scan health</CardTitle>
                      <CardDescription>Shows whether live books are actually being scanned.</CardDescription>
                    </div>
                    <Badge variant="outline">{data.book_scan.total_rows} rows</Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <SummaryMetric label="Fresh in 2h" value={data.book_scan.fresh_rows_2h} />
                    <SummaryMetric label="Stale rows" value={data.book_scan.stale_rows} />
                    <SummaryMetric label="FanDuel fresh" value={data.book_scan.fanduel_rows_2h} />
                    <SummaryMetric label="Unmatched pool" value={data.book_scan.unmatched_pool_candidates} />
                  </div>
                  <BreakdownChips items={data.book_scan.by_bookmaker.map((row) => ({ label: `${row.bookmaker} ${row.fresh_count_2h}/${row.count}`, count: row.count }))} />
                  <DataTable
                    rows={data.book_scan.latest_rows}
                    emptyMessage="No live book rows were found for the current pool players."
                    columns={[
                      { key: "player_name", label: "Player" },
                      { key: "prop_type", label: "Prop" },
                      { key: "bookmaker", label: "Book" },
                      { key: "current_line", label: "Line" },
                      { key: "over_price", label: "Over" },
                      { key: "under_price", label: "Under" },
                      { key: "age_minutes", label: "Age m" },
                      { key: "is_active", label: "Active" },
                    ]}
                  />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-xl">Downstream blockers</CardTitle>
                  <CardDescription>What is stopping parlays and straight bets right now.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    {Object.entries(data.generation_blockers.diagnostics).map(([key, value]) => (
                      <div key={key} className="rounded-lg border border-border/60 bg-muted/20 p-4">
                        <div className="text-xs uppercase tracking-wide text-muted-foreground">{key.replace(/_/g, " ")}</div>
                        <div className="mt-2 text-lg font-semibold text-foreground">{value ? "Yes" : "No"}</div>
                      </div>
                    ))}
                  </div>
                  <BreakdownChips items={data.generation_blockers.blocker_breakdown} />
                  <div className="rounded-lg border border-border/60 bg-muted/20 p-4 text-sm text-muted-foreground">
                    Thresholds: stale &gt; {data.generation_blockers.stale_threshold_minutes}m · fresh window {data.generation_blockers.fresh_window_minutes}m · line drift &gt; {data.generation_blockers.line_drift_threshold}
                  </div>
                </CardContent>
              </Card>
            </section>

            <section>
              <Tabs defaultValue="failed-legs" className="space-y-4">
                <TabsList className="h-auto w-full justify-start gap-1 overflow-x-auto rounded-lg bg-muted/60 p-1">
                  <TabsTrigger value="failed-legs">Failed legs</TabsTrigger>
                  <TabsTrigger value="risk-rejections">Risk rejections</TabsTrigger>
                  <TabsTrigger value="parlays">Parlays</TabsTrigger>
                  <TabsTrigger value="straights">Straight bets</TabsTrigger>
                </TabsList>

                <TabsContent value="failed-legs">
                  <Card>
                    <CardHeader>
                      <CardTitle>Manual-fix view</CardTitle>
                      <CardDescription>Exactly which pool legs are failing, with live line, drift, age, and reason.</CardDescription>
                      <div className="text-xs text-muted-foreground">Showing {Math.min(data.pick_pool.rows.length, 200)} of {data.pick_pool.rows.length} rows in this manual-fix table</div>
                    </CardHeader>
                    <CardContent>
                      <DataTable
                        rows={data.pick_pool.rows.slice(0, 200)}
                        emptyMessage="No pool failures to inspect."
                        columns={[
                          { key: "player_name", label: "Player" },
                          { key: "prop_type", label: "Prop" },
                          { key: "recommended_side", label: "Side" },
                          { key: "recommended_line", label: "Rec line" },
                          { key: "matched_bookmaker", label: "Book" },
                          { key: "live_line", label: "Live line" },
                          { key: "line_drift", label: "Drift" },
                          { key: "age_minutes", label: "Age m" },
                          { key: "status", label: "Status" },
                          { key: "failure_reason", label: "Reason" },
                        ]}
                      />
                    </CardContent>
                  </Card>
                </TabsContent>

                <TabsContent value="risk-rejections">
                  <Card>
                    <CardHeader>
                      <CardTitle>Risk-engine rejections</CardTitle>
                      <CardDescription>Rejected rows so you can see what got filtered before the pool even started.</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <DataTable
                        rows={data.engine_start.rejected_rows}
                        emptyMessage="No rejected risk rows for this date."
                        columns={[
                          { key: "player_name", label: "Player" },
                          { key: "prop_type", label: "Prop" },
                          { key: "side", label: "Side" },
                          { key: "line", label: "Line" },
                          { key: "confidence_score", label: "Conf" },
                          { key: "edge", label: "Edge" },
                          { key: "rejection_reason", label: "Rejection reason" },
                        ]}
                      />
                    </CardContent>
                  </Card>
                </TabsContent>

                <TabsContent value="parlays">
                  <Card>
                    <CardHeader>
                      <CardTitle>Pending parlays</CardTitle>
                      <CardDescription>Current downstream output after all matching and filters.</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <DataTable
                        rows={data.outputs.parlays}
                        emptyMessage="No pending parlays for this date."
                        columns={[
                          { key: "strategy_name", label: "Strategy" },
                          { key: "tier", label: "Tier" },
                          { key: "expected_odds", label: "Odds" },
                          { key: "combined_probability", label: "Prob" },
                          { key: "created_at", label: "Created" },
                        ]}
                      />
                    </CardContent>
                  </Card>
                </TabsContent>

                <TabsContent value="straights">
                  <Card>
                    <CardHeader>
                      <CardTitle>Pending straight bets</CardTitle>
                      <CardDescription>Standard and ceiling straights currently produced for the date.</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <DataTable
                        rows={data.outputs.straight_bets}
                        emptyMessage="No pending straight bets for this date."
                        columns={[
                          { key: "player_name", label: "Player" },
                          { key: "prop_type", label: "Prop" },
                          { key: "side", label: "Side" },
                          { key: "line", label: "Line" },
                          { key: "bet_type", label: "Type" },
                          { key: "line_source", label: "Book" },
                          { key: "american_odds", label: "Odds" },
                          { key: "created_at", label: "Created" },
                        ]}
                      />
                    </CardContent>
                  </Card>
                </TabsContent>
              </Tabs>
            </section>
          </>
        ) : null}
      </div>
    </AppShell>
  );
}