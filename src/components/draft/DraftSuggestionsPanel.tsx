import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Check, X, TrendingUp, TrendingDown, MessageSquare, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DraftSuggestion } from "@/hooks/useDraft";
import { formatDistanceToNow } from "date-fns";

interface DraftSuggestionsPanelProps {
  suggestions: DraftSuggestion[];
  isCreator: boolean;
  onAccept?: (suggestion: DraftSuggestion) => void;
  onReject?: (suggestion: DraftSuggestion) => void;
}

function formatPropType(propType: string): string {
  return propType
    .replace("player_", "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function DraftSuggestionsPanel({ 
  suggestions, 
  isCreator, 
  onAccept, 
  onReject 
}: DraftSuggestionsPanelProps) {
  const pendingSuggestions = suggestions.filter(s => s.status === "pending");
  const processedSuggestions = suggestions.filter(s => s.status !== "pending");

  if (suggestions.length === 0) {
    return (
      <Card className="p-6 text-center">
        <MessageSquare className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
        <p className="text-sm text-muted-foreground">
          No suggestions yet
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          Share the link to get suggestions from friends
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {pendingSuggestions.length > 0 && (
        <div>
          <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
            <Clock className="w-4 h-4" />
            Pending ({pendingSuggestions.length})
          </h4>
          <ScrollArea className="max-h-[300px]">
            <div className="space-y-2">
              {pendingSuggestions.map((suggestion) => (
                <SuggestionCard
                  key={suggestion.id}
                  suggestion={suggestion}
                  isCreator={isCreator}
                  onAccept={onAccept}
                  onReject={onReject}
                />
              ))}
            </div>
          </ScrollArea>
        </div>
      )}

      {processedSuggestions.length > 0 && (
        <div>
          <h4 className="text-sm font-medium mb-2 text-muted-foreground">
            Processed ({processedSuggestions.length})
          </h4>
          <ScrollArea className="max-h-[200px]">
            <div className="space-y-2">
              {processedSuggestions.map((suggestion) => (
                <SuggestionCard
                  key={suggestion.id}
                  suggestion={suggestion}
                  isCreator={false}
                />
              ))}
            </div>
          </ScrollArea>
        </div>
      )}
    </div>
  );
}

function SuggestionCard({
  suggestion,
  isCreator,
  onAccept,
  onReject,
}: {
  suggestion: DraftSuggestion;
  isCreator: boolean;
  onAccept?: (s: DraftSuggestion) => void;
  onReject?: (s: DraftSuggestion) => void;
}) {
  const isPending = suggestion.status === "pending";
  const leg = suggestion.suggested_leg;

  return (
    <Card className={cn(
      "p-3",
      suggestion.status === "accepted" && "border-accent/30 bg-accent/5",
      suggestion.status === "rejected" && "border-destructive/30 bg-destructive/5 opacity-60"
    )}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <p className="font-medium text-sm truncate">{leg.player_name}</p>
            <Badge
              variant="outline"
              className={cn(
                "text-[10px] shrink-0",
                suggestion.side === "over"
                  ? "border-accent text-accent"
                  : "border-destructive text-destructive"
              )}
            >
              {suggestion.side === "over" ? (
                <TrendingUp className="w-2 h-2 mr-0.5" />
              ) : (
                <TrendingDown className="w-2 h-2 mr-0.5" />
              )}
              {suggestion.side.toUpperCase()} {leg.current_line}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            {formatPropType(leg.prop_type)}
          </p>
          {suggestion.note && (
            <p className="text-xs text-muted-foreground mt-1 italic">
              "{suggestion.note}"
            </p>
          )}
          <p className="text-[10px] text-muted-foreground mt-1">
            by {suggestion.username} • {formatDistanceToNow(new Date(suggestion.created_at), { addSuffix: true })}
          </p>
        </div>

        {isPending && isCreator && onAccept && onReject ? (
          <div className="flex gap-1 shrink-0">
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8 text-accent hover:text-accent hover:bg-accent/10"
              onClick={() => onAccept(suggestion)}
            >
              <Check className="w-4 h-4" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
              onClick={() => onReject(suggestion)}
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        ) : (
          <Badge
            variant={suggestion.status === "accepted" ? "default" : "secondary"}
            className={cn(
              "text-[10px] shrink-0",
              suggestion.status === "accepted" && "bg-accent text-accent-foreground",
              suggestion.status === "rejected" && "bg-muted text-muted-foreground"
            )}
          >
            {suggestion.status}
          </Badge>
        )}
      </div>
    </Card>
  );
}
