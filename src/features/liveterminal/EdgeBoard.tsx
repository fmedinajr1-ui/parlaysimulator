import { useMemo, useState } from "react";
import type { PropEdgeRow } from "./hooks/useTerminalFeed";

function fmtOdds(n: number | null): string {
  if (n == null) return "—";
  return n > 0 ? `+${n}` : `${n}`;
}
function edgeColor(edgePct: number): string {
  if (edgePct >= 2) return "hsl(var(--state-over))";
  if (edgePct <= -2) return "hsl(var(--state-under))";
  return "hsl(var(--term-muted))";
}

export function EdgeBoard({ rows }: { rows: PropEdgeRow[] }) {
  const [filter, setFilter] = useState("");
  const filtered = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return rows.filter(
      (r) =>
        !f ||
        r.player_name.toLowerCase().includes(f) ||
        r.prop_label.toLowerCase().includes(f),
    );
  }, [rows, filter]);

  if (!rows.length) {
    return (
      <div className="rounded-md border border-[hsl(var(--term-grid))] bg-[hsl(var(--term-bg))] p-4 text-xs text-[hsl(var(--term-muted))]">
        No live prop quotes available for this game yet. Edges populate once at
        least two books post the same player prop.
      </div>
    );
  }

  return (
    <div className="rounded-md border border-[hsl(var(--term-grid))] bg-[hsl(var(--term-bg))]">
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-[hsl(var(--term-grid))]">
        <div className="text-[10px] uppercase tracking-[0.18em] text-[hsl(var(--term-muted))]">
          Sportsbook vs. model — live edges
        </div>
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter player / prop"
          className="bg-transparent border border-[hsl(var(--term-grid))] rounded px-2 py-0.5 text-[11px] text-[hsl(var(--term-text))] placeholder:text-[hsl(var(--term-muted))] focus:outline-none focus:border-[hsl(var(--term-muted))]"
        />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[11px] font-mono term-tabular">
          <thead>
            <tr className="text-[hsl(var(--term-muted))] uppercase tracking-wider text-[9px] border-b border-[hsl(var(--term-grid))]">
              <th className="text-left font-normal px-3 py-1.5">Player · Prop</th>
              <th className="text-right font-normal px-2 py-1.5">Line</th>
              <th className="text-right font-normal px-2 py-1.5">Book · Over</th>
              <th className="text-right font-normal px-2 py-1.5">Book · Under</th>
              <th className="text-right font-normal px-2 py-1.5">Fair · Over</th>
              <th className="text-right font-normal px-2 py-1.5">Fair · Under</th>
              <th className="text-right font-normal px-2 py-1.5">Model line</th>
              <th className="text-right font-normal px-2 py-1.5">Side</th>
              <th className="text-right font-normal px-2 py-1.5">Edge</th>
              <th className="text-right font-normal px-3 py-1.5">EV / $100</th>
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, 60).map((r) => {
              const color = edgeColor(r.edgePct);
              return (
                <tr key={r.key} className="border-b border-[hsl(var(--term-grid))]/60 hover:bg-white/[0.02]">
                  <td className="px-3 py-1.5 text-[hsl(var(--term-text))]">
                    <div className="font-sans font-medium">{r.player_name}</div>
                    <div className="text-[10px] text-[hsl(var(--term-muted))]">
                      {r.prop_label} · {r.refBook} · {r.bookCount}bk
                    </div>
                  </td>
                  <td className="px-2 py-1.5 text-right">{r.line}</td>
                  <td className="px-2 py-1.5 text-right">
                    {fmtOdds(r.refOver)}
                    <span className="ml-1 text-[10px] text-[hsl(var(--term-muted))]">
                      {r.refOverImpliedPct != null ? `${r.refOverImpliedPct}%` : ""}
                    </span>
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    {fmtOdds(r.refUnder)}
                    <span className="ml-1 text-[10px] text-[hsl(var(--term-muted))]">
                      {r.refUnderImpliedPct != null ? `${r.refUnderImpliedPct}%` : ""}
                    </span>
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    {r.fairOverPct != null ? `${r.fairOverPct}%` : "—"}
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    {r.fairUnderPct != null ? `${r.fairUnderPct}%` : "—"}
                  </td>
                  <td className="px-2 py-1.5 text-right">{r.modelLine.toFixed(2)}</td>
                  <td className="px-2 py-1.5 text-right">
                    {r.recommendedSide ? (
                      <span
                        className="inline-block px-1.5 py-[1px] rounded text-[10px] font-semibold"
                        style={{
                          background: `${color}22`,
                          color,
                          border: `1px solid ${color}55`,
                        }}
                      >
                        {r.recommendedSide}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-right font-semibold" style={{ color }}>
                    {r.edgePct > 0 ? "+" : ""}
                    {r.edgePct.toFixed(1)}pp
                  </td>
                  <td className="px-3 py-1.5 text-right font-semibold" style={{ color }}>
                    {r.impactPer100 > 0 ? "+" : ""}${r.impactPer100.toFixed(2)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="px-3 py-2 text-[10px] text-[hsl(var(--term-muted))] border-t border-[hsl(var(--term-grid))]">
        Fair % = de-vigged consensus across all books at the consensus line. Edge
        = fair − reference book. EV per $100 assumes a stake at the reference
        book price for the recommended side.
      </div>
    </div>
  );
}