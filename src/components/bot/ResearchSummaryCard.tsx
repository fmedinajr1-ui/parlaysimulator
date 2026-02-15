import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ChevronDown, ChevronRight, Search } from 'lucide-react';

interface FindingSummary {
  category: string;
  count: number;
  highRelevance: number;
}

export function ResearchSummaryCard() {
  const [isOpen, setIsOpen] = useState(false);
  const [categories, setCategories] = useState<FindingSummary[]>([]);
  const [totalFindings, setTotalFindings] = useState(0);
  const [highCount, setHighCount] = useState(0);
  const [lastRun, setLastRun] = useState<string | null>(null);

  useEffect(() => {
    fetchSummary();
  }, []);

  const fetchSummary = async () => {
    const today = format(new Date(), 'yyyy-MM-dd');
    const { data, error } = await supabase
      .from('bot_research_findings')
      .select('category, relevance_score, created_at')
      .eq('research_date', today)
      .order('created_at', { ascending: false });
    
    if (error || !data || data.length === 0) return;

    setTotalFindings(data.length);
    setLastRun(data[0].created_at);

    const map = new Map<string, { count: number; highRelevance: number }>();
    let high = 0;
    data.forEach((f: any) => {
      const entry = map.get(f.category) || { count: 0, highRelevance: 0 };
      entry.count++;
      if ((f.relevance_score ?? 0) >= 0.7) { entry.highRelevance++; high++; }
      map.set(f.category, entry);
    });
    setHighCount(high);
    setCategories(Array.from(map.entries()).map(([category, v]) => ({ category, ...v })));
  };

  if (totalFindings === 0) return null;

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <Card>
        <CollapsibleTrigger asChild>
          <CardHeader className="pb-2 cursor-pointer hover:bg-muted/30 transition-colors">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Search className="w-4 h-4 text-primary" />
                <CardTitle className="text-sm">Research Intelligence</CardTitle>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-[10px]">
                  {totalFindings} findings
                </Badge>
                {highCount > 0 && (
                  <Badge variant="outline" className="text-[10px] bg-green-500/20 text-green-400 border-green-500/30">
                    {highCount} high
                  </Badge>
                )}
                {isOpen ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
              </div>
            </div>
            {lastRun && (
              <p className="text-[10px] text-muted-foreground mt-1">
                Last run: {format(new Date(lastRun), 'h:mm a')} • {categories.length} categories
              </p>
            )}
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="pt-0 space-y-1.5">
            {categories.map(cat => (
              <div key={cat.category} className="flex items-center justify-between text-xs py-1 px-2 rounded bg-muted/30">
                <span className="text-muted-foreground capitalize">{cat.category.replace(/_/g, ' ')}</span>
                <div className="flex items-center gap-2">
                  <span>{cat.count}</span>
                  {cat.highRelevance > 0 && (
                    <span className="text-green-400">{cat.highRelevance} high</span>
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}
