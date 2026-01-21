import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { 
  Home, 
  Share2, 
  Plus, 
  TrendingUp, 
  TrendingDown, 
  Copy, 
  Check,
  Clock,
  User,
  Lock
} from "lucide-react";
import { useDraft, type ParlayDraft, type DraftSuggestion } from "@/hooks/useDraft";
import { DraftSuggestionsPanel } from "@/components/draft/DraftSuggestionsPanel";
import { SuggestLegModal } from "@/components/draft/SuggestLegModal";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import type { SelectedLeg } from "@/components/manual/ManualParlayPanel";

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

export default function DraftView() {
  const { shareCode } = useParams<{ shareCode: string }>();
  const navigate = useNavigate();
  const { getDraft, getSuggestions, updateSuggestionStatus, updateDraftLegs } = useDraft();

  const [draft, setDraft] = useState<ParlayDraft | null>(null);
  const [suggestions, setSuggestions] = useState<DraftSuggestion[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [suggestModalOpen, setSuggestModalOpen] = useState(false);

  const isCreator = userId === draft?.creator_id;
  const shareUrl = `${window.location.origin}/draft/${shareCode}`;

  const loadDraft = useCallback(async () => {
    if (!shareCode) return;
    
    const data = await getDraft(shareCode);
    if (!data) {
      toast.error("Draft not found or has expired");
      navigate("/");
      return;
    }
    setDraft(data);

    const sug = await getSuggestions(data.id);
    setSuggestions(sug);
    setIsLoading(false);
  }, [shareCode, getDraft, getSuggestions, navigate]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setUserId(data.session?.user?.id || null);
    });
    loadDraft();
  }, [loadDraft]);

  // Realtime subscription for suggestions
  useEffect(() => {
    if (!draft?.id) return;

    const channel = supabase
      .channel(`draft-${draft.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "draft_suggestions",
          filter: `draft_id=eq.${draft.id}`,
        },
        () => {
          loadDraft();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [draft?.id, loadDraft]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      toast.success("Link copied!");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Failed to copy");
    }
  };

  const handleAcceptSuggestion = async (suggestion: DraftSuggestion) => {
    if (!draft) return;
    
    const success = await updateSuggestionStatus(suggestion.id, "accepted");
    if (success) {
      // Add the leg to the draft
      const newLeg: SelectedLeg = {
        prop: suggestion.suggested_leg,
        side: suggestion.side,
      };
      const updatedLegs = [...draft.legs, newLeg];
      await updateDraftLegs(draft.id, updatedLegs);
      
      setDraft({ ...draft, legs: updatedLegs });
      setSuggestions(prev => 
        prev.map(s => s.id === suggestion.id ? { ...s, status: "accepted" } : s)
      );
      toast.success("Leg added to draft!");
    }
  };

  const handleRejectSuggestion = async (suggestion: DraftSuggestion) => {
    const success = await updateSuggestionStatus(suggestion.id, "rejected");
    if (success) {
      setSuggestions(prev => 
        prev.map(s => s.id === suggestion.id ? { ...s, status: "rejected" } : s)
      );
    }
  };

  // Calculate combined odds
  const combinedDecimalOdds = (draft?.legs || []).reduce((acc, leg) => {
    const odds = leg.side === "over" ? leg.prop.over_price : leg.prop.under_price;
    if (!odds) return acc;
    return acc * americanToDecimal(odds);
  }, 1);

  const combinedAmericanOdds = (draft?.legs.length || 0) > 0 
    ? decimalToAmerican(combinedDecimalOdds) 
    : 0;

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background pb-24">
        <div className="container py-6 max-w-2xl">
          <Skeleton className="h-8 w-48 mb-4" />
          <Skeleton className="h-24 w-full mb-4" />
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    );
  }

  if (!draft) {
    return null;
  }

  return (
    <div className="min-h-screen bg-background pb-24">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b">
        <div className="container py-4 max-w-2xl">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <Button 
                variant="ghost" 
                size="icon" 
                onClick={() => navigate("/")}
                className="shrink-0"
              >
                <Home className="w-5 h-5" />
              </Button>
              <div>
                <h1 className="text-lg font-bold line-clamp-1">{draft.name}</h1>
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  Created {formatDistanceToNow(new Date(draft.created_at), { addSuffix: true })}
                </p>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={handleCopy}>
              {copied ? (
                <Check className="w-4 h-4" />
              ) : (
                <Copy className="w-4 h-4" />
              )}
            </Button>
          </div>
        </div>
      </div>

      <div className="container py-6 max-w-2xl space-y-6">
        {/* Draft Status */}
        {draft.status === "finalized" && (
          <Card className="p-4 border-primary/50 bg-primary/5">
            <div className="flex items-center gap-2">
              <Lock className="w-5 h-5 text-primary" />
              <p className="font-medium">This draft has been finalized</p>
            </div>
          </Card>
        )}

        {/* Current Legs */}
        <Card className="p-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold">Current Parlay</h2>
            <Badge variant="secondary">
              {draft.legs.length} leg{draft.legs.length !== 1 ? "s" : ""}
            </Badge>
          </div>

          {draft.legs.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              No legs added yet
            </p>
          ) : (
            <div className="space-y-2">
              {draft.legs.map((leg, index) => {
                const odds = leg.side === "over" ? leg.prop.over_price : leg.prop.under_price;
                return (
                  <div
                    key={index}
                    className="flex items-center justify-between p-3 rounded-lg bg-muted/50"
                  >
                    <div>
                      <p className="font-medium text-sm">{leg.prop.player_name}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs text-muted-foreground">
                          {formatPropType(leg.prop.prop_type)}
                        </span>
                        <Badge
                          variant="outline"
                          className={cn(
                            "text-[10px]",
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
                    <span className="text-sm font-mono">
                      {odds && odds > 0 ? `+${odds}` : odds}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {draft.legs.length > 0 && (
            <div className="mt-4 pt-4 border-t flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Combined Odds</span>
              <span className="text-lg font-bold">
                {combinedAmericanOdds > 0 ? "+" : ""}{combinedAmericanOdds}
              </span>
            </div>
          )}
        </Card>

        {/* Suggest Leg Button */}
        {draft.status !== "finalized" && (
          <Button 
            className="w-full" 
            size="lg"
            onClick={() => {
              if (!userId) {
                toast.error("Please sign in to suggest a leg");
                navigate("/auth");
                return;
              }
              setSuggestModalOpen(true);
            }}
          >
            <Plus className="w-5 h-5 mr-2" />
            Suggest a Leg
          </Button>
        )}

        {/* Suggestions */}
        <div>
          <h2 className="font-semibold mb-3 flex items-center gap-2">
            <User className="w-4 h-4" />
            Suggestions
          </h2>
          <DraftSuggestionsPanel
            suggestions={suggestions}
            isCreator={isCreator}
            onAccept={handleAcceptSuggestion}
            onReject={handleRejectSuggestion}
          />
        </div>

        {/* Share Section */}
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <Share2 className="w-4 h-4 text-primary" />
            <h3 className="font-medium">Share this draft</h3>
          </div>
          <p className="text-sm text-muted-foreground mb-3">
            Send this link to friends so they can suggest legs for your parlay.
          </p>
          <div className="flex gap-2">
            <input
              value={shareUrl}
              readOnly
              className="flex-1 px-3 py-2 text-sm rounded-md border bg-muted/50 font-mono"
            />
            <Button variant="outline" onClick={handleCopy}>
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            </Button>
          </div>
        </Card>
      </div>

      {/* Suggest Modal */}
      <SuggestLegModal
        open={suggestModalOpen}
        onOpenChange={setSuggestModalOpen}
        draftId={draft.id}
        onSuggestionAdded={loadDraft}
      />
    </div>
  );
}
