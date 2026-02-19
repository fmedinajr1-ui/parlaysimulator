import React from 'react';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Shield, Scale, Flame } from 'lucide-react';
import { useRiskMode, type RiskMode } from '@/contexts/RiskModeContext';
import { Card, CardContent } from '@/components/ui/card';

const MODES: { value: RiskMode; label: string; icon: React.ElementType; desc: string }[] = [
  { value: 'conservative', label: 'Conservative', icon: Shield, desc: 'Lower stakes, earlier hedges' },
  { value: 'balanced', label: 'Balanced', icon: Scale, desc: 'Standard sizing & timing' },
  { value: 'aggressive', label: 'Aggressive', icon: Flame, desc: 'Full Kelly, late hedges' },
];

export function CustomerRiskToggle() {
  const { riskMode, setRiskMode } = useRiskMode();

  return (
    <Card className="border-border/50">
      <CardContent className="p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Risk Mode</span>
        </div>
        <ToggleGroup
          type="single"
          value={riskMode}
          onValueChange={(v) => v && setRiskMode(v as RiskMode)}
          className="w-full"
        >
          {MODES.map(({ value, label, icon: Icon }) => (
            <ToggleGroupItem
              key={value}
              value={value}
              className="flex-1 gap-1.5 text-xs data-[state=on]:bg-primary/15 data-[state=on]:text-primary"
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <p className="text-[10px] text-muted-foreground mt-1.5 text-center">
          {MODES.find(m => m.value === riskMode)?.desc}
        </p>
      </CardContent>
    </Card>
  );
}
