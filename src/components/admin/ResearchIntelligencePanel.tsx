import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Skeleton } from '@/components/ui/skeleton';
import { CalendarIcon, ChevronDown, ChevronRight, Search, Clock, Play, RefreshCw } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

interface ResearchFinding {
  id: string;
  category: string;
  title: string;
  summary: string;
  key_insights: any;
  relevance_score: number | null;
  action_taken: string | null;
  actionable: boolean | null;
  sources: string[] | null;
  research_date: string;
  created_at: string;
}

function RelevanceBadge({ score }: { score: number | null }) {
  if (score === null) return <Badge variant="outline" className="text-[10px]">N/A</Badge>;
  const color = score >= 0.7 ? 'bg-green-500/20 text-green-400 border-green-500/30' 
    : score >= 0.4 ? 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' 
    : 'bg-red-500/20 text-red-400 border-red-500/30';
  return <Badge variant="outline" className={cn('text-[10px]', color)}>{(score * 100).toFixed(0)}%</Badge>;
}

function ActionTag({ action }: { action: string | null }) {
  if (!action || action === 'none') return null;
  return <Badge variant="secondary" className="text-[10px]">{action}</Badge>;
}

export function ResearchIntelligencePanel() {
  const [date, setDate] = useState<Date>(new Date());
  const [findings, setFindings] = useState<ResearchFinding[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRunning, setIsRunning] = useState(false);
  const [openCategories, setOpenCategories] = useState<Set<string>>(new Set());
  const [expandedFindings, setExpandedFindings] = useState<Set<string>>(new Set());
  const { toast } = useToast();

  useEffect(() => {
    fetchFindings();
  }, [date]);

  const fetchFindings = async () => {
    setIsLoading(true);
    const dateStr = format(date, 'yyyy-MM-dd');
    const { data, error } = await supabase
      .from('bot_research_findings')
      .select('*')
      .eq('research_date', dateStr)
      .order('created_at', { ascending: false });
    
    if (!error && data) {
      setFindings(data);
      setOpenCategories(new Set((data as ResearchFinding[]).map(f => f.category)));
    }
    setIsLoading(false);
  };

  const grouped = useMemo(() => {
    const map = new Map<string, ResearchFinding[]>();
    findings.forEach(f => {
      const list = map.get(f.category) || [];
      list.push(f);
      map.set(f.category, list);
    });
    return map;
  }, [findings]);

  const highRelevance = findings.filter(f => (f.relevance_score ?? 0) >= 0.7).length;
  const lastRun = findings.length > 0 ? findings[0].created_at : null;

  const toggleCategory = (cat: string) => {
    const next = new Set(openCategories);
    next.has(cat) ? next.delete(cat) : next.add(cat);
    setOpenCategories(next);
  };

  const toggleFinding = (id: string) => {
    const next = new Set(expandedFindings);
    next.has(id) ? next.delete(id) : next.add(id);
    setExpandedFindings(next);
  };

  const handleRunAgent = async () => {
    setIsRunning(true);
    try {
      const { data, error } = await supabase.functions.invoke('ai-research-agent', { method: 'POST' });
      if (error) throw error;
      toast({ title: 'Research Complete', description: `Agent finished. Refreshing findings...` });
      await fetchFindings();
    } catch (err) {
      toast({ title: 'Research Failed', description: err instanceof Error ? err.message : 'Unknown error', variant: 'destructive' });
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Header with date picker */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Research Findings</h2>
          <p className="text-sm text-muted-foreground">
            {findings.length} findings from {grouped.size} categories
            {highRelevance > 0 && <span className="text-green-400"> • {highRelevance} high relevance</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="default"
            size="sm"
            className="gap-2"
            onClick={handleRunAgent}
            disabled={isRunning}
          >
            {isRunning ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
            {isRunning ? 'Running…' : 'Run Agent'}
          </Button>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2">
                <CalendarIcon className="w-3.5 h-3.5" />
                {format(date, 'MMM d')}
              </Button>
            </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="end">
            <Calendar
              mode="single"
              selected={date}
              onSelect={(d) => d && setDate(d)}
              disabled={(d) => d > new Date()}
              className="p-3 pointer-events-auto"
            />
          </PopoverContent>
        </Popover>
        </div>
      </div>

      {/* Last run timestamp */}
      {lastRun && (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Clock className="w-3 h-3" />
          Last research: {format(new Date(lastRun), 'h:mm a')}
        </div>
      )}

      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : findings.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            <Search className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No research findings for {format(date, 'MMM d, yyyy')}.</p>
            <p className="text-xs mt-1">Run the AI Research Agent to generate.</p>
          </CardContent>
        </Card>
      ) : (
        Array.from(grouped.entries()).map(([category, items]) => (
          <Collapsible 
            key={category} 
            open={openCategories.has(category)}
            onOpenChange={() => toggleCategory(category)}
          >
            <Card>
              <CollapsibleTrigger asChild>
                <CardHeader className="pb-2 cursor-pointer hover:bg-muted/30 transition-colors">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {openCategories.has(category) ? (
                        <ChevronDown className="w-4 h-4 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="w-4 h-4 text-muted-foreground" />
                      )}
                      <CardTitle className="text-sm font-medium">{category.replace(/_/g, ' ')}</CardTitle>
                    </div>
                    <Badge variant="outline" className="text-[10px]">{items.length}</Badge>
                  </div>
                </CardHeader>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <CardContent className="pt-0 space-y-3">
                  {items.map(finding => {
                    const isExpanded = expandedFindings.has(finding.id);
                    const insights = Array.isArray(finding.key_insights) ? finding.key_insights : [];
                    return (
                      <div 
                        key={finding.id} 
                        className="p-3 rounded-lg bg-muted/30 border border-border/50 space-y-2 cursor-pointer hover:bg-muted/50 transition-colors"
                        onClick={() => toggleFinding(finding.id)}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm font-medium">{finding.title}</p>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <RelevanceBadge score={finding.relevance_score} />
                            <ActionTag action={finding.action_taken} />
                          </div>
                        </div>
                        <p className={cn("text-xs text-muted-foreground", !isExpanded && "line-clamp-3")}>{finding.summary}</p>
                        
                        {isExpanded && insights.length > 0 && (
                          <div className="space-y-1 pt-1">
                            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Key Insights</p>
                            <ul className="space-y-0.5 pl-3">
                              {insights.map((insight: string, i: number) => (
                                <li key={i} className="text-xs text-muted-foreground list-disc">{String(insight)}</li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {isExpanded && finding.sources && finding.sources.length > 0 && (
                          <div className="space-y-1 pt-1">
                            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Sources</p>
                            <div className="flex flex-wrap gap-1.5">
                              {finding.sources.map((src, i) => (
                                <a 
                                  key={i} 
                                  href={src.startsWith('http') ? src : `https://${src}`} 
                                  target="_blank" 
                                  rel="noopener noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                  className="text-[10px] text-primary hover:underline truncate max-w-[200px]"
                                >
                                  {src.replace(/^https?:\/\//, '').split('/')[0]}
                                </a>
                              ))}
                            </div>
                          </div>
                        )}

                        <div className="flex items-center justify-between">
                          <span className="text-[10px] text-muted-foreground">
                            {format(new Date(finding.created_at), 'h:mm a')}
                          </span>
                          <span className="text-[10px] text-muted-foreground">
                            {isExpanded ? 'Click to collapse' : 'Click to expand'}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </CardContent>
              </CollapsibleContent>
            </Card>
          </Collapsible>
        ))
      )}
    </div>
  );
}
