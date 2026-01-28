import { useState } from "react";
import { useSettledPicks, useSettledPicksCount, useSettledPicksCategories } from "@/hooks/useSettledPicks";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Check, X, Minus, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { format, parseISO } from "date-fns";

const CATEGORY_DISPLAY: Record<string, string> = {
  'THREE_POINT_SHOOTER': '3PT',
  'STAR_FLOOR_OVER': 'Star',
  'ROLE_PLAYER_REB': 'Role Reb',
  'BIG_REBOUNDER': 'Big Reb',
  'VOLUME_SCORER': 'Volume',
  'BIG_ASSIST_OVER': 'Big Ast',
  'LOW_SCORER_UNDER': 'Low U',
  'MID_SCORER_UNDER': 'Mid U',
  'ELITE_REB_OVER': 'Elite Reb',
};

const PROP_DISPLAY: Record<string, string> = {
  'points': 'PTS',
  'rebounds': 'REB',
  'assists': 'AST',
  'threes': '3PM',
  'pts_rebs_asts': 'PRA',
  'pts_rebs': 'P+R',
  'pts_asts': 'P+A',
  'rebs_asts': 'R+A',
};

interface SettledPicksTableProps {
  className?: string;
}

export function SettledPicksTable({ className }: SettledPicksTableProps) {
  const [limit, setLimit] = useState(50);
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [propFilter, setPropFilter] = useState<string>('all');
  const [outcomeFilter, setOutcomeFilter] = useState<string>('all');

  const { data: picks, isLoading } = useSettledPicks({
    category: categoryFilter,
    propType: propFilter,
    outcome: outcomeFilter,
    limit,
  });

  const { data: totalCount } = useSettledPicksCount();
  const { data: categories } = useSettledPicksCategories();

  const formatPick = (propType: string, side: string | null, line: number | null) => {
    const prop = PROP_DISPLAY[propType] || propType.toUpperCase();
    const sideChar = side === 'over' ? 'O' : side === 'under' ? 'U' : '';
    const lineStr = line !== null ? line.toString() : '-';
    return `${prop} ${sideChar}${lineStr}`;
  };

  const formatDate = (dateStr: string) => {
    try {
      return format(parseISO(dateStr), 'MMM d');
    } catch {
      return dateStr;
    }
  };

  const getCategoryDisplay = (category: string) => {
    return CATEGORY_DISPLAY[category] || category.replace(/_/g, ' ').slice(0, 10);
  };

  const getOutcomeDisplay = (outcome: string, score: number | null) => {
    const scoreStr = score !== null ? score.toString() : '-';
    
    switch (outcome) {
      case 'hit':
        return (
          <span className="flex items-center gap-1 text-green-400 font-medium">
            {scoreStr} <Check className="w-3.5 h-3.5" />
          </span>
        );
      case 'miss':
        return (
          <span className="flex items-center gap-1 text-red-400 font-medium">
            {scoreStr} <X className="w-3.5 h-3.5" />
          </span>
        );
      case 'push':
        return (
          <span className="flex items-center gap-1 text-yellow-400 font-medium">
            {scoreStr} <Minus className="w-3.5 h-3.5" />
          </span>
        );
      default:
        return scoreStr;
    }
  };

  const filterChips = [
    { label: 'All', value: 'all', type: 'outcome' as const },
    { label: 'Hits', value: 'hit', type: 'outcome' as const },
    { label: 'Misses', value: 'miss', type: 'outcome' as const },
  ];

  const propChips = [
    { label: 'All', value: 'all' },
    { label: 'PTS', value: 'points' },
    { label: 'REB', value: 'rebounds' },
    { label: 'AST', value: 'assists' },
    { label: '3PM', value: 'threes' },
  ];

  return (
    <div className={cn("space-y-3 mt-3", className)}>
      {/* Outcome Filter Chips */}
      <ScrollArea className="w-full whitespace-nowrap">
        <div className="flex gap-2 pb-2">
          {filterChips.map(chip => (
            <Badge
              key={chip.value}
              variant={outcomeFilter === chip.value ? "default" : "outline"}
              className={cn(
                "cursor-pointer transition-colors px-3 py-1",
                outcomeFilter === chip.value 
                  ? "bg-primary text-primary-foreground" 
                  : "hover:bg-muted"
              )}
              onClick={() => setOutcomeFilter(chip.value)}
            >
              {chip.label}
            </Badge>
          ))}
          <div className="w-px h-5 bg-border self-center" />
          {propChips.map(chip => (
            <Badge
              key={chip.value}
              variant={propFilter === chip.value ? "default" : "outline"}
              className={cn(
                "cursor-pointer transition-colors px-3 py-1",
                propFilter === chip.value 
                  ? "bg-primary text-primary-foreground" 
                  : "hover:bg-muted"
              )}
              onClick={() => setPropFilter(chip.value)}
            >
              {chip.label}
            </Badge>
          ))}
        </div>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>

      {/* Category Filter */}
      {categories && categories.length > 0 && (
        <ScrollArea className="w-full whitespace-nowrap">
          <div className="flex gap-2 pb-2">
            <Badge
              variant={categoryFilter === 'all' ? "default" : "outline"}
              className={cn(
                "cursor-pointer transition-colors px-3 py-1",
                categoryFilter === 'all' 
                  ? "bg-primary text-primary-foreground" 
                  : "hover:bg-muted"
              )}
              onClick={() => setCategoryFilter('all')}
            >
              All Categories
            </Badge>
            {categories.map(cat => (
              <Badge
                key={cat}
                variant={categoryFilter === cat ? "default" : "outline"}
                className={cn(
                  "cursor-pointer transition-colors px-3 py-1",
                  categoryFilter === cat 
                    ? "bg-primary text-primary-foreground" 
                    : "hover:bg-muted"
                )}
                onClick={() => setCategoryFilter(cat)}
              >
                {getCategoryDisplay(cat)}
              </Badge>
            ))}
          </div>
          <ScrollBar orientation="horizontal" />
        </ScrollArea>
      )}

      {/* Table */}
      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : picks && picks.length > 0 ? (
        <>
          <div className="rounded-lg border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30">
                  <TableHead className="text-xs font-medium">Player</TableHead>
                  <TableHead className="text-xs font-medium w-[60px]">Date</TableHead>
                  <TableHead className="text-xs font-medium w-[80px]">Pick</TableHead>
                  <TableHead className="text-xs font-medium w-[60px] text-right">Result</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {picks.map((pick, idx) => (
                  <TableRow key={`${pick.player_name}-${pick.analysis_date}-${pick.prop_type}-${idx}`}>
                    <TableCell className="py-2">
                      <div className="flex flex-col">
                        <span className="font-medium text-sm truncate max-w-[140px]">
                          {pick.player_name}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {getCategoryDisplay(pick.category)}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground py-2">
                      {formatDate(pick.analysis_date)}
                    </TableCell>
                    <TableCell className="text-xs font-mono py-2">
                      {formatPick(pick.prop_type, pick.recommended_side, pick.line)}
                    </TableCell>
                    <TableCell className="text-right py-2">
                      {getOutcomeDisplay(pick.outcome, pick.score)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Load More */}
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>
              Showing {picks.length} of {totalCount || picks.length} picks
            </span>
            {picks.length >= limit && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setLimit(prev => prev + 50)}
              >
                Load More
              </Button>
            )}
          </div>
        </>
      ) : (
        <div className="text-center py-8 text-muted-foreground">
          No settled picks found
        </div>
      )}
    </div>
  );
}
