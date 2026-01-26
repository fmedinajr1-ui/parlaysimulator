import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Play, Pause } from "lucide-react";
import { Sport } from "@/lib/whaleUtils";
import { TimeWindow, ConfidenceFilter } from "@/hooks/useWhaleProxy";

interface WhaleFiltersProps {
  selectedSport: Sport | 'ALL';
  onSportChange: (sport: Sport | 'ALL') => void;
  confidenceFilter: ConfidenceFilter;
  onConfidenceChange: (filter: ConfidenceFilter) => void;
  timeWindow: TimeWindow;
  onTimeWindowChange: (window: TimeWindow) => void;
  isSimulating: boolean;
  onToggleSimulation: () => void;
}

export function WhaleFilters({
  selectedSport,
  onSportChange,
  confidenceFilter,
  onConfidenceChange,
  timeWindow,
  onTimeWindowChange,
  isSimulating,
  onToggleSimulation
}: WhaleFiltersProps) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      {/* Sport Filter */}
      <Select value={selectedSport} onValueChange={(v) => onSportChange(v as Sport | 'ALL')}>
        <SelectTrigger className="w-[120px] bg-background/50 border-border/50">
          <SelectValue placeholder="Sport" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="ALL">All Sports</SelectItem>
          <SelectItem value="NBA">NBA</SelectItem>
          <SelectItem value="WNBA">WNBA</SelectItem>
          <SelectItem value="MLB">MLB</SelectItem>
          <SelectItem value="NHL">NHL</SelectItem>
          <SelectItem value="TENNIS">Tennis</SelectItem>
        </SelectContent>
      </Select>

      {/* Confidence Filter */}
      <Select value={confidenceFilter} onValueChange={(v) => onConfidenceChange(v as ConfidenceFilter)}>
        <SelectTrigger className="w-[100px] bg-background/50 border-border/50">
          <SelectValue placeholder="Grade" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="A">A Only</SelectItem>
          <SelectItem value="A+B">A + B</SelectItem>
          <SelectItem value="ALL">All</SelectItem>
        </SelectContent>
      </Select>

      {/* Time Window */}
      <Select value={timeWindow} onValueChange={(v) => onTimeWindowChange(v as TimeWindow)}>
        <SelectTrigger className="w-[100px] bg-background/50 border-border/50">
          <SelectValue placeholder="Time" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="15m">15 min</SelectItem>
          <SelectItem value="1h">1 hour</SelectItem>
          <SelectItem value="today">Today</SelectItem>
        </SelectContent>
      </Select>

      {/* Simulate Toggle */}
      <Button
        variant={isSimulating ? "destructive" : "neon"}
        size="sm"
        onClick={onToggleSimulation}
        className="gap-2"
      >
        {isSimulating ? (
          <>
            <Pause className="w-4 h-4" />
            Stop Feed
          </>
        ) : (
          <>
            <Play className="w-4 h-4" />
            Simulate Live
          </>
        )}
      </Button>
    </div>
  );
}
