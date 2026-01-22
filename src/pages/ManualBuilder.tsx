import React, { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useManualBuilder, type ManualProp } from "@/hooks/useManualBuilder";
import { PropSelectionCard } from "@/components/manual/PropSelectionCard";
import { ManualParlayPanel, type SelectedLeg } from "@/components/manual/ManualParlayPanel";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, Filter, Dumbbell, Home } from "lucide-react";

const STAT_FILTERS = [
  { key: "all", label: "All" },
  { key: "rebound", label: "Rebounds" },
  { key: "point", label: "Points" },
  { key: "assist", label: "Assists" },
  { key: "three", label: "3PT" },
  { key: "steal", label: "Steals" },
  { key: "block", label: "Blocks" },
];

export default function ManualBuilder() {
  const navigate = useNavigate();
  const [statFilter, setStatFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedLegs, setSelectedLegs] = useState<SelectedLeg[]>([]);

  const { props, isLoading, isConnected, getDefenseForMatchup } = useManualBuilder(statFilter);

  // Filter props by search
  const filteredProps = useMemo(() => {
    if (!searchQuery.trim()) return props;
    const query = searchQuery.toLowerCase();
    return props.filter(
      (p) =>
        p.player_name.toLowerCase().includes(query) ||
        p.game_description?.toLowerCase().includes(query)
    );
  }, [props, searchQuery]);

  // Selection handlers
  const handleSelectProp = (prop: ManualProp, side: "over" | "under") => {
    setSelectedLegs((prev) => {
      const existing = prev.find((l) => l.prop.id === prop.id);
      if (existing) {
        // Update side if different
        if (existing.side !== side) {
          return prev.map((l) =>
            l.prop.id === prop.id ? { ...l, side } : l
          );
        }
        return prev;
      }
      return [...prev, { prop, side }];
    });
  };

  const handleDeselectProp = (propId: string) => {
    setSelectedLegs((prev) => prev.filter((l) => l.prop.id !== propId));
  };

  const handleClear = () => {
    setSelectedLegs([]);
  };

  const getSelectedSide = (propId: string): "over" | "under" | null => {
    const leg = selectedLegs.find((l) => l.prop.id === propId);
    return leg?.side || null;
  };

  // Auto-remove stale selections when props are deleted by cleanup cron
  React.useEffect(() => {
    if (!isLoading && props.length > 0 && selectedLegs.length > 0) {
      const propIds = new Set(props.map(p => p.id));
      const hasStale = selectedLegs.some(leg => !propIds.has(leg.prop.id));
      if (hasStale) {
        setSelectedLegs(prev => prev.filter(leg => propIds.has(leg.prop.id)));
      }
    }
  }, [props, isLoading, selectedLegs]);

  return (
    <div className="min-h-screen bg-background pb-24">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b">
        <div className="container py-4">
          <div className="flex items-center gap-3 mb-4">
            <Button 
              variant="ghost" 
              size="icon" 
              onClick={() => navigate("/")}
              className="shrink-0 -ml-2"
            >
              <Home className="w-5 h-5" />
            </Button>
            <Dumbbell className="w-6 h-6 text-primary" />
            <h1 className="text-xl font-bold">Manual Parlay Builder</h1>
            {isConnected && (
              <Badge variant="outline" className="text-xs gap-1 border-green-500/50">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                Live
              </Badge>
            )}
            {selectedLegs.length > 0 && (
              <Badge variant="secondary" className="ml-auto">
                {selectedLegs.length} selected
              </Badge>
            )}
          </div>

          {/* Search */}
          <div className="relative mb-3">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search player, team..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>

          {/* Stat Filters */}
          <div className="flex gap-2 overflow-x-auto pb-2">
            {STAT_FILTERS.map((filter) => (
              <Button
                key={filter.key}
                variant={statFilter === filter.key ? "default" : "outline"}
                size="sm"
                onClick={() => setStatFilter(filter.key)}
                className="shrink-0"
              >
                {filter.label}
              </Button>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="container py-4">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Props Grid */}
          <div className="lg:col-span-2">
            {isLoading ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {Array.from({ length: 8 }).map((_, i) => (
                  <Skeleton key={i} className="h-40" />
                ))}
              </div>
            ) : filteredProps.length === 0 ? (
              <div className="text-center py-12">
                <Filter className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
                <p className="text-muted-foreground">No props found</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Try adjusting your filters
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {filteredProps.map((prop) => (
                  <PropSelectionCard
                    key={prop.id}
                    prop={prop}
                    defense={getDefenseForMatchup(prop.game_description, prop.prop_type)}
                    isSelected={selectedLegs.some((l) => l.prop.id === prop.id)}
                    selectedSide={getSelectedSide(prop.id)}
                    onSelect={handleSelectProp}
                    onDeselect={handleDeselectProp}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Parlay Panel (Sticky on desktop) */}
          <div className="lg:sticky lg:top-36 lg:h-[calc(100vh-10rem)]">
            <ManualParlayPanel
              selectedLegs={selectedLegs}
              onRemoveLeg={handleDeselectProp}
              onClear={handleClear}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
