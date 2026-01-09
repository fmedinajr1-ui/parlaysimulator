import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Eye, ArrowUpRight, Flame } from "lucide-react";

interface WatchlistItem {
  id: string;
  player_name: string;
  market_type: string;
  line: number;
  side: string;
  sport: string;
  signal_label: string;
  approaching_entry: boolean;
  final_score: number;
  reason: string;
}

interface WatchlistSectionProps {
  items: WatchlistItem[];
}

export function WatchlistSection({ items }: WatchlistSectionProps) {
  if (!items || items.length === 0) {
    return (
      <Card className="border-muted/50">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Eye className="h-5 w-5 text-muted-foreground" />
            Watchlist
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground text-center py-4">
            No props approaching entry threshold
          </p>
        </CardContent>
      </Card>
    );
  }

  const getSignalColor = (label: string) => {
    switch (label) {
      case 'STRONG_SHARP':
        return 'text-emerald-400';
      case 'SHARP_LEAN':
        return 'text-blue-400';
      default:
        return 'text-muted-foreground';
    }
  };

  return (
    <Card className="border-muted/50">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Eye className="h-5 w-5 text-primary" />
          Watchlist
          <Badge variant="secondary" className="ml-auto">{items.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {items.map((item) => (
          <div 
            key={item.id} 
            className={`p-3 rounded-lg border ${
              item.approaching_entry 
                ? 'border-primary/30 bg-primary/5' 
                : 'border-muted/30 bg-muted/10'
            }`}
          >
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{item.player_name}</span>
                  {item.approaching_entry && (
                    <Badge className="bg-primary/20 text-primary border-primary/30 text-xs">
                      <ArrowUpRight className="h-3 w-3 mr-1" />
                      Approaching
                    </Badge>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">
                  {item.market_type} {item.side.toUpperCase()} {item.line}
                </p>
              </div>
              <div className="text-right">
                <div className="flex items-center gap-1">
                  <Flame className="h-4 w-4 text-orange-500" />
                  <span className="font-mono text-sm">{item.final_score}</span>
                </div>
                <span className={`text-xs ${getSignalColor(item.signal_label)}`}>
                  {item.signal_label.replace('_', ' ')}
                </span>
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-1">{item.reason}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
