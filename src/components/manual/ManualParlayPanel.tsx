import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { X, Trash2, Calculator, Save, TrendingUp, TrendingDown, Share2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useParlayBuilder } from "@/contexts/ParlayBuilderContext";
import { toast } from "sonner";
import { ShareDraftModal } from "@/components/draft/ShareDraftModal";
import type { ManualProp } from "@/hooks/useManualBuilder";

export interface SelectedLeg {
  prop: ManualProp;
  side: "over" | "under";
}

interface ManualParlayPanelProps {
  selectedLegs: SelectedLeg[];
  onRemoveLeg: (propId: string) => void;
  onClear: () => void;
}

function americanToDecimal(odds: number): number {
  if (odds > 0) return odds / 100 + 1;
  return 100 / Math.abs(odds) + 1;
}

function decimalToAmerican(decimal: number): number {
  if (decimal >= 2) return Math.round((decimal - 1) * 100);
  return Math.round(-100 / (decimal - 1));
}

function formatPropType(propType: string): string {
  return propType
    .replace("player_", "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function ManualParlayPanel({
  selectedLegs,
  onRemoveLeg,
  onClear,
}: ManualParlayPanelProps) {
  const { addLeg } = useParlayBuilder();
  const [shareModalOpen, setShareModalOpen] = useState(false);

  // Calculate combined odds
  const combinedDecimalOdds = selectedLegs.reduce((acc, leg) => {
    const odds = leg.side === "over" ? leg.prop.over_price : leg.prop.under_price;
    if (!odds) return acc;
    return acc * americanToDecimal(odds);
  }, 1);

  const combinedAmericanOdds = selectedLegs.length > 0 
    ? decimalToAmerican(combinedDecimalOdds) 
    : 0;

  const impliedProbability = selectedLegs.length > 0 
    ? (1 / combinedDecimalOdds) * 100 
    : 0;

  const potentialPayout = (100 * combinedDecimalOdds).toFixed(2);

  const handleAddToMainBuilder = () => {
    selectedLegs.forEach((leg) => {
      const odds = leg.side === "over" ? leg.prop.over_price : leg.prop.under_price;
      addLeg({
        description: `${leg.prop.player_name} ${formatPropType(leg.prop.prop_type)} ${leg.side.toUpperCase()} ${leg.prop.current_line}`,
        odds: odds || -110,
        source: "manual",
        playerName: leg.prop.player_name,
        propType: leg.prop.prop_type,
        line: leg.prop.current_line,
        side: leg.side,
        eventId: leg.prop.event_id || undefined,
      });
    });
    toast.success(`Added ${selectedLegs.length} legs to parlay builder`);
    onClear();
  };

  if (selectedLegs.length === 0) {
    return (
      <Card className="p-6 text-center">
        <Calculator className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
        <p className="text-sm text-muted-foreground">
          Select props to build your parlay
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          Click OVER or UNDER on any prop card
        </p>
      </Card>
    );
  }

  return (
    <Card className="flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b flex items-center justify-between">
        <div>
          <h3 className="font-semibold">Your Parlay</h3>
          <p className="text-xs text-muted-foreground">
            {selectedLegs.length} leg{selectedLegs.length !== 1 ? "s" : ""}
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={onClear}>
          <Trash2 className="w-4 h-4" />
        </Button>
      </div>

      {/* Legs List */}
      <ScrollArea className="flex-1 p-4">
        <div className="space-y-2">
          {selectedLegs.map((leg) => {
            const odds = leg.side === "over" ? leg.prop.over_price : leg.prop.under_price;
            return (
              <div
                key={leg.prop.id}
                className="flex items-center justify-between p-2 rounded-md bg-muted/50"
              >
                <div className="flex-1 min-w-0 mr-2">
                  <p className="text-sm font-medium truncate">
                    {leg.prop.player_name}
                  </p>
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <span>{formatPropType(leg.prop.prop_type)}</span>
                    <Badge
                      variant="outline"
                      className={cn(
                        "text-[10px] px-1",
                        leg.side === "over"
                          ? "border-accent text-accent"
                          : "border-destructive text-destructive"
                      )}
                    >
                      {leg.side === "over" ? (
                        <TrendingUp className="w-2 h-2 mr-0.5" />
                      ) : (
                        <TrendingDown className="w-2 h-2 mr-0.5" />
                      )}
                      {leg.side.toUpperCase()} {leg.prop.current_line}
                    </Badge>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-mono">
                    {odds && odds > 0 ? `+${odds}` : odds}
                  </span>
                  <button
                    onClick={() => onRemoveLeg(leg.prop.id)}
                    className="p-1 hover:bg-destructive/20 rounded"
                  >
                    <X className="w-3 h-3 text-muted-foreground" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </ScrollArea>

      {/* Stats Footer */}
      <div className="p-4 border-t space-y-3">
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <p className="text-xs text-muted-foreground">Combined Odds</p>
            <p className="font-bold text-lg">
              {combinedAmericanOdds > 0 ? "+" : ""}
              {combinedAmericanOdds}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Win Probability</p>
            <p className="font-bold text-lg">
              {impliedProbability.toFixed(1)}%
            </p>
          </div>
        </div>

        <div className="p-2 rounded bg-primary/10">
          <p className="text-xs text-muted-foreground">$100 Wins</p>
          <p className="font-bold text-xl text-primary">${potentialPayout}</p>
        </div>

        <div className="flex gap-2">
          <Button 
            variant="outline"
            className="flex-1"
            onClick={() => setShareModalOpen(true)}
          >
            <Share2 className="w-4 h-4 mr-2" />
            Share
          </Button>
          <Button 
            className="flex-1" 
            onClick={handleAddToMainBuilder}
          >
            <Save className="w-4 h-4 mr-2" />
            Add
          </Button>
        </div>
      </div>

      <ShareDraftModal
        open={shareModalOpen}
        onOpenChange={setShareModalOpen}
        legs={selectedLegs}
      />
    </Card>
  );
}
