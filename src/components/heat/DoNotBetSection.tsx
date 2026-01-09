import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Ban, AlertOctagon } from "lucide-react";

interface DoNotBetItem {
  id: string;
  player_name: string;
  market_type: string;
  line: number;
  side: string;
  sport: string;
  trap_reason: string;
  final_score: number;
}

interface DoNotBetSectionProps {
  items: DoNotBetItem[];
}

export function DoNotBetSection({ items }: DoNotBetSectionProps) {
  if (!items || items.length === 0) {
    return null; // Don't show section if no traps detected
  }

  return (
    <Card className="border-destructive/30 bg-destructive/5">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-lg text-destructive">
          <Ban className="h-5 w-5" />
          Do Not Bet
          <Badge variant="destructive" className="ml-auto">{items.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {items.map((item) => (
          <div 
            key={item.id} 
            className="p-3 rounded-lg border border-destructive/20 bg-destructive/10"
          >
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2">
                <AlertOctagon className="h-4 w-4 text-destructive" />
                <div>
                  <span className="font-medium">{item.player_name}</span>
                  <p className="text-sm text-muted-foreground">
                    {item.market_type} {item.side.toUpperCase()} {item.line}
                  </p>
                </div>
              </div>
              <Badge variant="destructive" className="text-xs">
                Score: {item.final_score}
              </Badge>
            </div>
            <p className="text-xs text-destructive/80 mt-2">{item.trap_reason}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
