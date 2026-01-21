import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Search, TrendingUp, TrendingDown, Loader2 } from "lucide-react";
import { useManualBuilder, type ManualProp } from "@/hooks/useManualBuilder";
import { useDraft } from "@/hooks/useDraft";
import { cn } from "@/lib/utils";

interface SuggestLegModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  draftId: string;
  onSuggestionAdded: () => void;
}

function formatPropType(propType: string): string {
  return propType
    .replace("player_", "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function SuggestLegModal({ open, onOpenChange, draftId, onSuggestionAdded }: SuggestLegModalProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedProp, setSelectedProp] = useState<ManualProp | null>(null);
  const [selectedSide, setSelectedSide] = useState<"over" | "under" | null>(null);
  const [note, setNote] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { props, isLoading: propsLoading } = useManualBuilder();
  const { addSuggestion } = useDraft();

  const filteredProps = props.filter(p =>
    p.player_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    formatPropType(p.prop_type).toLowerCase().includes(searchQuery.toLowerCase())
  ).slice(0, 20);

  const handleSubmit = async () => {
    if (!selectedProp || !selectedSide) return;

    setIsSubmitting(true);
    const success = await addSuggestion(draftId, selectedProp, selectedSide, note);
    setIsSubmitting(false);

    if (success) {
      onSuggestionAdded();
      handleClose();
    }
  };

  const handleClose = () => {
    setSearchQuery("");
    setSelectedProp(null);
    setSelectedSide(null);
    setNote("");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Suggest a Leg</DialogTitle>
          <DialogDescription>
            Search for a prop and select your pick to suggest it to the draft owner.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-hidden flex flex-col gap-4">
          {!selectedProp ? (
            <>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Search players or prop types..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9"
                />
              </div>

              <ScrollArea className="flex-1 min-h-[200px] max-h-[300px]">
                {propsLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                  </div>
                ) : filteredProps.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8">
                    {searchQuery ? "No props found" : "Start typing to search"}
                  </p>
                ) : (
                  <div className="space-y-2 pr-4">
                    {filteredProps.map((prop) => (
                      <button
                        key={prop.id}
                        onClick={() => setSelectedProp(prop)}
                        className="w-full p-3 text-left rounded-lg border bg-card hover:bg-accent/50 transition-colors"
                      >
                        <p className="font-medium">{prop.player_name}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <Badge variant="secondary" className="text-xs">
                            {formatPropType(prop.prop_type)}
                          </Badge>
                          <span className="text-sm text-muted-foreground">
                            Line: {prop.current_line}
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </>
          ) : (
            <div className="space-y-4">
              <div className="p-4 rounded-lg border bg-muted/30">
                <p className="font-semibold">{selectedProp.player_name}</p>
                <p className="text-sm text-muted-foreground">
                  {formatPropType(selectedProp.prop_type)} • Line: {selectedProp.current_line}
                </p>
              </div>

              <div className="space-y-2">
                <Label>Your Pick</Label>
                <div className="grid grid-cols-2 gap-3">
                  <Button
                    type="button"
                    variant={selectedSide === "over" ? "default" : "outline"}
                    className={cn(
                      "h-16 flex-col gap-1",
                      selectedSide === "over" && "ring-2 ring-primary"
                    )}
                    onClick={() => setSelectedSide("over")}
                  >
                    <TrendingUp className="w-5 h-5" />
                    <span>OVER {selectedProp.current_line}</span>
                    <span className="text-xs opacity-70">
                      {selectedProp.over_price && selectedProp.over_price > 0 ? "+" : ""}
                      {selectedProp.over_price}
                    </span>
                  </Button>
                  <Button
                    type="button"
                    variant={selectedSide === "under" ? "default" : "outline"}
                    className={cn(
                      "h-16 flex-col gap-1",
                      selectedSide === "under" && "ring-2 ring-primary"
                    )}
                    onClick={() => setSelectedSide("under")}
                  >
                    <TrendingDown className="w-5 h-5" />
                    <span>UNDER {selectedProp.current_line}</span>
                    <span className="text-xs opacity-70">
                      {selectedProp.under_price && selectedProp.under_price > 0 ? "+" : ""}
                      {selectedProp.under_price}
                    </span>
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="note">Note (optional)</Label>
                <Textarea
                  id="note"
                  placeholder="Why do you like this pick?"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  maxLength={200}
                  rows={3}
                />
              </div>

              <div className="flex gap-2 pt-2">
                <Button
                  variant="outline"
                  onClick={() => setSelectedProp(null)}
                  className="flex-1"
                >
                  Back
                </Button>
                <Button
                  onClick={handleSubmit}
                  disabled={!selectedSide || isSubmitting}
                  className="flex-1"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Submitting...
                    </>
                  ) : (
                    "Submit Suggestion"
                  )}
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
