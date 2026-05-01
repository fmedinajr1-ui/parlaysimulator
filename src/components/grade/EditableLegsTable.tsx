import { Trash2, Plus, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface EditableLeg {
  id: string;
  player: string;
  propType: string;
  line: string; // keep as string for input; parsed on submit
  side: "over" | "under";
  odds: string; // american, e.g. "-110" or "+150"
  confidence?: number; // 0..1 from OCR
  raw?: string; // original OCR/paste line for fallback description
}

const PROP_TYPES = [
  "points",
  "rebounds",
  "assists",
  "threes",
  "pra",
  "pr",
  "pa",
  "ra",
  "steals",
  "blocks",
  "turnovers",
  "hits",
  "total_bases",
  "strikeouts",
  "home_runs",
  "rbis",
  "passing_yards",
  "rushing_yards",
  "receiving_yards",
  "receptions",
  "passing_tds",
  "shots_on_goal",
  "goals",
  "saves",
  "other",
];

export function newBlankLeg(): EditableLeg {
  return {
    id: crypto.randomUUID(),
    player: "",
    propType: "points",
    line: "",
    side: "over",
    odds: "-110",
  };
}

interface Props {
  legs: EditableLeg[];
  onChange: (legs: EditableLeg[]) => void;
}

export function EditableLegsTable({ legs, onChange }: Props) {
  const update = (id: string, patch: Partial<EditableLeg>) => {
    onChange(legs.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  };
  const remove = (id: string) => onChange(legs.filter((l) => l.id !== id));
  const add = () => onChange([...legs, newBlankLeg()]);

  return (
    <div className="space-y-2">
      {legs.map((leg, i) => {
        const lowConf = typeof leg.confidence === "number" && leg.confidence < 0.7;
        return (
          <div
            key={leg.id}
            className={cn(
              "rounded-lg border bg-background/60 p-3 space-y-2",
              lowConf ? "border-yellow-500/60 bg-yellow-500/5" : "border-border"
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
                Leg {i + 1}
                {lowConf && (
                  <span className="ml-2 inline-flex items-center gap-1 text-yellow-500">
                    <AlertTriangle className="w-3 h-3" /> double-check
                  </span>
                )}
              </span>
              <button
                type="button"
                onClick={() => remove(leg.id)}
                className="p-1 rounded hover:bg-destructive/15 text-muted-foreground hover:text-destructive"
                aria-label="Remove leg"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>

            <Input
              value={leg.player}
              onChange={(e) => update(leg.id, { player: e.target.value })}
              placeholder="Player name"
              className="h-9 text-sm"
            />

            <div className="grid grid-cols-[1fr_auto] gap-2">
              <select
                value={leg.propType}
                onChange={(e) => update(leg.id, { propType: e.target.value })}
                className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              >
                {PROP_TYPES.map((p) => (
                  <option key={p} value={p}>
                    {p.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
              <Input
                value={leg.line}
                onChange={(e) => update(leg.id, { line: e.target.value })}
                placeholder="Line"
                inputMode="decimal"
                className="h-9 text-sm w-20 text-center"
              />
            </div>

            <div className="grid grid-cols-[1fr_auto] gap-2">
              <div className="flex rounded-md border border-input overflow-hidden">
                {(["over", "under"] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => update(leg.id, { side: s })}
                    className={cn(
                      "flex-1 h-9 text-xs font-bold uppercase tracking-wide transition",
                      leg.side === s
                        ? s === "over"
                          ? "bg-emerald-500/20 text-emerald-500"
                          : "bg-rose-500/20 text-rose-500"
                        : "text-muted-foreground hover:bg-muted/50"
                    )}
                  >
                    {s}
                  </button>
                ))}
              </div>
              <Input
                value={leg.odds}
                onChange={(e) => update(leg.id, { odds: e.target.value })}
                placeholder="-110"
                className="h-9 text-sm w-20 text-center font-mono"
              />
            </div>
          </div>
        );
      })}

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={add}
        className="w-full gap-2"
      >
        <Plus className="w-4 h-4" /> Add leg
      </Button>
    </div>
  );
}

export function legToGradePayload(leg: EditableLeg) {
  const lineNum = parseFloat(leg.line);
  const oddsTrim = leg.odds?.trim() || "-110";
  const description =
    leg.player && !isNaN(lineNum)
      ? `${leg.player} ${leg.side === "over" ? "Over" : "Under"} ${lineNum} ${leg.propType.replace(/_/g, " ")} ${oddsTrim}`
      : leg.raw || `${leg.player} ${leg.propType} ${leg.line} ${leg.odds}`.trim();
  return {
    description,
    odds: oddsTrim,
    player: leg.player || undefined,
    propType: leg.propType,
    line: isNaN(lineNum) ? undefined : lineNum,
    side: leg.side,
  };
}

export function parsePastedSlip(text: string): EditableLeg[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((line) => {
      const oddsMatch = line.match(/[+-]\d{2,4}/);
      const lineMatch = line.match(/(\d+(?:\.\d+)?)/);
      const lower = line.toLowerCase();
      const side: "over" | "under" =
        /\b(under|less|lower|u\b)/i.test(line) ? "under" : "over";
      // crude prop type sniff
      let propType = "points";
      const map: Record<string, string> = {
        rebound: "rebounds",
        reb: "rebounds",
        assist: "assists",
        ast: "assists",
        three: "threes",
        "3pt": "threes",
        pra: "pra",
        hit: "hits",
        strikeout: "strikeouts",
        " k ": "strikeouts",
        pass: "passing_yards",
        rush: "rushing_yards",
        rec: "receiving_yards",
        td: "passing_tds",
        sog: "shots_on_goal",
        goal: "goals",
        save: "saves",
      };
      for (const k of Object.keys(map)) {
        if (lower.includes(k)) {
          propType = map[k];
          break;
        }
      }
      // player guess: text before the line number
      let player = "";
      if (lineMatch) {
        player = line.slice(0, lineMatch.index).replace(/(over|under|o|u)\b/gi, "").trim();
      }
      return {
        id: crypto.randomUUID(),
        player,
        propType,
        line: lineMatch ? lineMatch[1] : "",
        side,
        odds: oddsMatch ? oddsMatch[0] : "-110",
        raw: line,
      } as EditableLeg;
    });
}