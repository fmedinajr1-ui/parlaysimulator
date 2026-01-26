import React from 'react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Flame } from 'lucide-react';
import { cn } from '@/lib/utils';

export type PropKind = 'Points' | 'Rebounds' | 'Assists' | 'PRA';

interface EdgeFiltersProps {
  propFilter: PropKind | 'ALL';
  onPropFilterChange: (filter: PropKind | 'ALL') => void;
  hideVolatile: boolean;
  onHideVolatileChange: (hide: boolean) => void;
  startersOnly: boolean;
  onStartersOnlyChange: (startersOnly: boolean) => void;
  minConfidence: number;
  onMinConfidenceChange: (min: number) => void;
  fatigueUndersOnly: boolean;
  onFatigueUndersOnlyChange: (value: boolean) => void;
}

const PROP_OPTIONS: Array<PropKind | 'ALL'> = ['ALL', 'Points', 'Rebounds', 'Assists', 'PRA'];
const PROP_LABELS: Record<PropKind | 'ALL', string> = {
  'ALL': 'ALL',
  'Points': 'PTS',
  'Rebounds': 'REB',
  'Assists': 'AST',
  'PRA': 'PRA',
};

export function EdgeFilters({
  propFilter,
  onPropFilterChange,
  hideVolatile,
  onHideVolatileChange,
  startersOnly,
  onStartersOnlyChange,
  minConfidence,
  onMinConfidenceChange,
  fatigueUndersOnly,
  onFatigueUndersOnlyChange,
}: EdgeFiltersProps) {
  return (
    <div className="space-y-3">
      {/* Prop Type Filter Chips */}
      <div className="flex flex-wrap gap-2">
        {PROP_OPTIONS.map((prop) => (
          <Button
            key={prop}
            variant={propFilter === prop ? 'default' : 'outline'}
            size="sm"
            onClick={() => onPropFilterChange(prop)}
            className={cn(
              "h-8 px-3",
              propFilter === prop && "bg-primary text-primary-foreground"
            )}
          >
            {PROP_LABELS[prop]}
          </Button>
        ))}
      </div>

      {/* Toggles Row */}
      <div className="flex flex-wrap items-center gap-4">
        {/* Hide Volatility Toggle */}
        <div className="flex items-center gap-2">
          <Switch
            id="hide-volatile"
            checked={hideVolatile}
            onCheckedChange={onHideVolatileChange}
          />
          <Label htmlFor="hide-volatile" className="text-sm cursor-pointer">
            Hide Volatile
          </Label>
        </div>

        {/* Starters Only Toggle */}
        <div className="flex items-center gap-2">
          <Switch
            id="starters-only"
            checked={startersOnly}
            onCheckedChange={onStartersOnlyChange}
          />
          <Label htmlFor="starters-only" className="text-sm cursor-pointer">
            Starters/Closers
          </Label>
        </div>

        {/* Fatigue Unders Toggle */}
        <div className="flex items-center gap-2">
          <Switch
            id="fatigue-unders"
            checked={fatigueUndersOnly}
            onCheckedChange={onFatigueUndersOnlyChange}
          />
          <Label htmlFor="fatigue-unders" className="text-sm cursor-pointer flex items-center gap-1">
            <Flame className="w-3.5 h-3.5 text-destructive" />
            Fatigue Unders
          </Label>
        </div>

        {/* Confidence Slider */}
        <div className="flex items-center gap-3 ml-auto">
          <span className="text-sm text-muted-foreground">Min Conf</span>
          <Slider
            value={[minConfidence]}
            onValueChange={([v]) => onMinConfidenceChange(v)}
            min={50}
            max={90}
            step={5}
            className="w-24"
          />
          <Badge variant="secondary" className="font-mono text-xs w-12 justify-center">
            {minConfidence}%
          </Badge>
        </div>
      </div>
    </div>
  );
}
