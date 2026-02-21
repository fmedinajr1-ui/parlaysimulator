import React from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import type { WarRoomPropData } from './WarRoomPropCard';

interface HedgeModeTableProps {
  props: WarRoomPropData[];
}

const PROP_SHORT: Record<string, string> = {
  points: 'PTS', assists: 'AST', threes: '3PT',
  rebounds: 'REB', blocks: 'BLK', steals: 'STL',
};

export function HedgeModeTable({ props }: HedgeModeTableProps) {
  if (props.length === 0) {
    return (
      <div className="warroom-card p-4 text-center text-sm text-muted-foreground">
        No live props to display in Hedge Mode.
      </div>
    );
  }

  return (
    <div className="warroom-card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-[hsl(var(--warroom-card-border))] text-muted-foreground text-[10px] uppercase tracking-wider">
              <th className="text-left font-medium p-2">Prop</th>
              <th className="text-right font-medium p-2">Current</th>
              <th className="text-right font-medium p-2">Line</th>
              <th className="text-right font-medium p-2">Proj</th>
              <th className="text-right font-medium p-2">Edge</th>
              <th className="text-right font-medium p-2">Hedge</th>
            </tr>
          </thead>
          <tbody>
            {props.map((p) => {
              const edge = p.projectedFinal - p.line;
              const hedgeSuggestion = edge > 2 ? 'LOCK' : edge > 0 ? 'HOLD' : edge > -2 ? 'MONITOR' : 'EXIT';
              const hedgeColor = {
                LOCK: 'text-[hsl(var(--warroom-green))]',
                HOLD: 'text-foreground',
                MONITOR: 'text-[hsl(var(--warroom-gold))]',
                EXIT: 'text-[hsl(var(--warroom-danger))]',
              }[hedgeSuggestion];

              return (
                <motion.tr
                  key={p.id}
                  layout
                  className="border-b border-[hsl(var(--warroom-card-border)/0.5)] hover:bg-[hsl(var(--warroom-card-border)/0.3)]"
                >
                  <td className="p-2">
                    <span className="font-medium text-foreground">{p.playerName}</span>
                    <span className="text-muted-foreground ml-1">
                      {PROP_SHORT[p.propType] || p.propType}
                    </span>
                  </td>
                  <td className="text-right p-2 tabular-nums font-medium text-foreground">
                    {p.currentValue}
                  </td>
                  <td className="text-right p-2 tabular-nums text-muted-foreground">
                    {p.line}
                  </td>
                  <td className="text-right p-2 tabular-nums font-medium text-foreground">
                    {p.projectedFinal.toFixed(1)}
                  </td>
                  <td className={cn(
                    'text-right p-2 tabular-nums font-bold',
                    edge > 0 ? 'text-[hsl(var(--warroom-green))]' : edge < -1 ? 'text-[hsl(var(--warroom-danger))]' : 'text-muted-foreground'
                  )}>
                    {edge >= 0 ? '+' : ''}{edge.toFixed(1)}
                  </td>
                  <td className={cn('text-right p-2 font-bold', hedgeColor)}>
                    {hedgeSuggestion}
                  </td>
                </motion.tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
