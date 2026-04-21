import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { TrendingUp, Check } from "lucide-react";

interface Signal {
  id: string;
  sport: string;
  matchup: string;
  pick: string;
  sharp_pct: number;
  public_pct: number;
  line_movement: string | null;
  hit_rate: string | null;
}

export function SharpTracker() {
  const [signals, setSignals] = useState<Signal[]>([]);
  const [tailed, setTailed] = useState<Set<string>>(new Set());

  useEffect(() => {
    supabase
      .from("sharp_signals")
      .select("*")
      .eq("is_active", true)
      .order("display_order", { ascending: true })
      .limit(8)
      .then(({ data }) => {
        if (data) setSignals(data as Signal[]);
      });
  }, []);

  const handleTail = (id: string) => setTailed((prev) => new Set(prev).add(id));

  return (
    <section id="sharp-tracker" className="relative py-24 px-5">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-12">
          <div className="text-xs uppercase tracking-widest text-[hsl(var(--sharp-green))] mb-2 inline-flex items-center gap-2">
            <TrendingUp className="w-3.5 h-3.5" /> Sharp Tracker — Live
          </div>
          <h2 className="farm-display text-4xl md:text-5xl font-bold mb-3">Where the smart money's running.</h2>
          <p className="text-[hsl(var(--farm-muted))] max-w-xl mx-auto">Reverse line movement and pro-money signals — refreshed continuously.</p>
        </div>

        <div className="space-y-3">
          {signals.map((s) => {
            const isTailed = tailed.has(s.id);
            return (
              <div key={s.id} className="farm-panel p-5 grid md:grid-cols-[1fr_2fr_auto] gap-5 items-center">
                <div>
                  <div className="text-xs text-[hsl(var(--farm-muted))] uppercase tracking-wider">{s.sport}</div>
                  <div className="farm-display text-lg font-bold mt-0.5">{s.matchup}</div>
                  <div className="text-sm mt-1" style={{ color: "hsl(var(--sharp-green))" }}>{s.pick}</div>
                </div>

                <div>
                  <div className="flex items-center justify-between text-xs text-[hsl(var(--farm-muted))] mb-1.5">
                    <span>Sharp <strong className="text-[hsl(var(--sharp-green))]">{s.sharp_pct}%</strong></span>
                    <span>Public <strong className="text-[hsl(var(--trap-red))]">{s.public_pct}%</strong></span>
                  </div>
                  <div className="flex h-2 rounded-full overflow-hidden bg-[hsl(var(--farm-line))]">
                    <div className="transition-all duration-1000" style={{ width: `${s.sharp_pct}%`, background: "hsl(var(--sharp-green))" }} />
                    <div className="transition-all duration-1000" style={{ width: `${100 - s.sharp_pct}%`, background: "hsl(var(--trap-red) / 0.6)" }} />
                  </div>
                  {s.line_movement && (
                    <div className="text-xs text-[hsl(var(--farm-muted))] mt-2">📈 {s.line_movement}</div>
                  )}
                  {s.hit_rate && (
                    <div className="text-xs text-[hsl(var(--barn-amber))] mt-1">🎯 {s.hit_rate}</div>
                  )}
                </div>

                <button
                  onClick={() => handleTail(s.id)}
                  disabled={isTailed}
                  className={isTailed ? "farm-btn-ghost text-sm" : "farm-btn-primary text-sm"}
                  style={isTailed ? { color: "hsl(var(--sharp-green))", borderColor: "hsl(var(--sharp-green) / 0.6)" } : undefined}
                >
                  {isTailed ? <><Check className="w-4 h-4 inline -mt-0.5 mr-1" />Tailed</> : "🐕 Tail"}
                </button>
              </div>
            );
          })}
          {signals.length === 0 && (
            <div className="farm-panel p-8 text-center text-[hsl(var(--farm-muted))]">Loading sharp signals…</div>
          )}
        </div>
      </div>
    </section>
  );
}
