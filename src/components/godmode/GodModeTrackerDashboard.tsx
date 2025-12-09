import React, { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { GodModePropCard } from './GodModePropCard';
import { Zap, Target, X, AlertTriangle, Search, RefreshCw, Loader2, TrendingUp, Satellite, Database, Clock } from 'lucide-react';
import { toast } from 'sonner';
import { motion } from 'framer-motion';

interface TrackedProp {
  id: string;
  event_id: string | null;
  sport: string;
  game_description: string;
  player_name: string;
  prop_type: string;
  bookmaker: string;
  opening_line: number;
  opening_over_price: number;
  opening_under_price: number;
  current_line: number | null;
  current_over_price: number | null;
  current_under_price: number | null;
  price_movement_over: number | null;
  ai_recommendation: string | null;
  ai_direction: string | null;
  ai_confidence: number | null;
  ai_reasoning: string | null;
  ai_signals: unknown;
  status: string;
  commence_time: string | null;
  created_at: string;
}

export function GodModeTrackerDashboard() {
  const [props, setProps] = useState<TrackedProp[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [scanning, setScanning] = useState(false);
  
  const [searchQuery, setSearchQuery] = useState('');
  const [sportFilter, setSportFilter] = useState('all');
  const [recFilter, setRecFilter] = useState('all');

  const fetchAnalyzedProps = async () => {
    try {
      const { data, error } = await supabase
        .from('sharp_line_tracker')
        .select('*')
        .not('ai_recommendation', 'is', null)
        .gte('commence_time', new Date().toISOString())
        .order('commence_time', { ascending: true });

      if (error) throw error;
      setProps((data || []) as unknown as TrackedProp[]);
    } catch (error) {
      console.error('Error fetching props:', error);
      toast.error('Failed to fetch analyzed props');
    } finally {
      setLoading(false);
    }
  };

  const fetchPendingCount = async () => {
    try {
      const { count, error } = await supabase
        .from('sharp_line_tracker')
        .select('*', { count: 'exact', head: true })
        .is('ai_recommendation', null)
        .eq('status', 'pending')
        .gte('commence_time', new Date().toISOString());

      if (error) throw error;
      setPendingCount(count || 0);
    } catch (error) {
      console.error('Error fetching pending count:', error);
    }
  };

  useEffect(() => {
    fetchAnalyzedProps();
    fetchPendingCount();

    // Real-time subscription
    const channel = supabase
      .channel('god-mode-tracker')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'sharp_line_tracker'
        },
        () => {
          fetchAnalyzedProps();
          fetchPendingCount();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const handleRefresh = async () => {
    setRefreshing(true);
    await Promise.all([fetchAnalyzedProps(), fetchPendingCount()]);
    setRefreshing(false);
    toast.success('Refreshed');
  };

  const handleGenerateData = async () => {
    setGenerating(true);
    toast.info('Scanning for fresh props and running analysis...', { duration: 8000 });
    
    try {
      // Step 1: First scan for fresh props from today's games
      console.log('[GOD MODE] Scanning for fresh props...');
      const { error: scanError } = await supabase.functions.invoke('scan-opening-lines', {
        body: { sports: ['NBA', 'NFL'] }
      });
      
      if (scanError) {
        console.error('[GOD MODE] Scan error:', scanError);
        // Continue anyway - we might have existing props to analyze
      }
      
      // Step 2: Run analysis on upcoming game props
      console.log('[GOD MODE] Running analysis...');
      const { data, error } = await supabase.functions.invoke('auto-refresh-sharp-tracker', {
        body: {
          useOpeningFallback: true,
          batchSize: 50,
          prioritizeUpcoming: true
        }
      });
      
      if (error) throw error;
      
      await Promise.all([fetchAnalyzedProps(), fetchPendingCount()]);
      
      const analyzed = data?.analyze?.success || 0;
      const scanned = data?.fetch?.total || 0;
      toast.success(`Complete! Scanned ${scanned} props, analyzed ${analyzed}`);
    } catch (error) {
      console.error('Error generating data:', error);
      toast.error('Failed to run analysis');
    } finally {
      setGenerating(false);
    }
  };

  const handleScanProps = async () => {
    setScanning(true);
    toast.info('Scanning for new props...', { duration: 5000 });
    
    try {
      const { data, error } = await supabase.functions.invoke('scan-opening-lines');
      
      if (error) throw error;
      
      await fetchPendingCount();
      
      const added = data?.added_count || 0;
      toast.success(`Scan complete! ${added} new props found`);
    } catch (error) {
      console.error('Error scanning props:', error);
      toast.error('Failed to scan props');
    } finally {
      setScanning(false);
    }
  };

  const filteredProps = props.filter(prop => {
    const matchesSearch = !searchQuery || 
      prop.player_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      prop.game_description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      prop.prop_type.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesSport = sportFilter === 'all' || prop.sport === sportFilter;
    const matchesRec = recFilter === 'all' || prop.ai_recommendation === recFilter;
    
    return matchesSearch && matchesSport && matchesRec;
  });

  const pickProps = filteredProps.filter(p => p.ai_recommendation === 'pick');
  const fadeProps = filteredProps.filter(p => p.ai_recommendation === 'fade');
  const cautionProps = filteredProps.filter(p => p.ai_recommendation === 'caution');
  
  const highConfProps = filteredProps.filter(p => p.ai_confidence && p.ai_confidence >= 0.7);

  const stats = {
    total: props.length,
    picks: props.filter(p => p.ai_recommendation === 'pick').length,
    fades: props.filter(p => p.ai_recommendation === 'fade').length,
    caution: props.filter(p => p.ai_recommendation === 'caution').length,
    highConf: props.filter(p => p.ai_confidence && p.ai_confidence >= 0.7).length,
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-24">
      {/* Hero Header */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-primary/20 via-primary/10 to-background border border-primary/20 p-6">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-primary/10 via-transparent to-transparent" />
        <div className="relative">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 rounded-xl bg-primary/20">
              <Zap className="w-6 h-6 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold font-display">GOD MODE Tracker</h1>
              <p className="text-muted-foreground">Sharp vs Vegas - Real-Time Intelligence</p>
            </div>
          </div>

          {/* Pending Props Banner */}
          {pendingCount > 0 && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20 mb-4">
              <Clock className="w-4 h-4 text-yellow-400" />
              <span className="text-sm text-yellow-400 font-medium">
                {pendingCount} props pending analysis
              </span>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex flex-wrap gap-3">
            <Button 
              onClick={handleGenerateData} 
              disabled={generating}
              className="bg-primary hover:bg-primary/90"
            >
              {generating ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Database className="w-4 h-4 mr-2" />
              )}
              {generating ? 'Analyzing...' : 'Generate Fresh Data'}
            </Button>
            
            <Button 
              variant="outline" 
              onClick={handleScanProps} 
              disabled={scanning}
            >
              {scanning ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Satellite className="w-4 h-4 mr-2" />
              )}
              {scanning ? 'Scanning...' : 'Scan New Props'}
            </Button>
          </div>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
          <Card className="bg-card/50">
            <CardContent className="p-4 text-center">
              <TrendingUp className="w-5 h-5 mx-auto mb-1 text-muted-foreground" />
              <p className="text-2xl font-bold">{stats.total}</p>
              <p className="text-xs text-muted-foreground">Total Analyzed</p>
            </CardContent>
          </Card>
        </motion.div>
        
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
          <Card className="bg-green-500/10 border-green-500/20">
            <CardContent className="p-4 text-center">
              <Target className="w-5 h-5 mx-auto mb-1 text-green-400" />
              <p className="text-2xl font-bold text-green-400">{stats.picks}</p>
              <p className="text-xs text-muted-foreground">Picks</p>
            </CardContent>
          </Card>
        </motion.div>
        
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
          <Card className="bg-red-500/10 border-red-500/20">
            <CardContent className="p-4 text-center">
              <X className="w-5 h-5 mx-auto mb-1 text-red-400" />
              <p className="text-2xl font-bold text-red-400">{stats.fades}</p>
              <p className="text-xs text-muted-foreground">Fades</p>
            </CardContent>
          </Card>
        </motion.div>
        
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }}>
          <Card className="bg-yellow-500/10 border-yellow-500/20">
            <CardContent className="p-4 text-center">
              <AlertTriangle className="w-5 h-5 mx-auto mb-1 text-yellow-400" />
              <p className="text-2xl font-bold text-yellow-400">{stats.caution}</p>
              <p className="text-xs text-muted-foreground">Caution</p>
            </CardContent>
          </Card>
        </motion.div>
        
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
          <Card className="bg-primary/10 border-primary/20">
            <CardContent className="p-4 text-center">
              <Zap className="w-5 h-5 mx-auto mb-1 text-primary" />
              <p className="text-2xl font-bold text-primary">{stats.highConf}</p>
              <p className="text-xs text-muted-foreground">High Conf</p>
            </CardContent>
          </Card>
        </motion.div>
      </div>

      {/* Filters */}
      <Card className="bg-card/50">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search players, games..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            
            <Select value={sportFilter} onValueChange={setSportFilter}>
              <SelectTrigger className="w-[130px]">
                <SelectValue placeholder="Sport" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Sports</SelectItem>
                <SelectItem value="basketball_nba">NBA</SelectItem>
                <SelectItem value="americanfootball_nfl">NFL</SelectItem>
              </SelectContent>
            </Select>

            <Select value={recFilter} onValueChange={setRecFilter}>
              <SelectTrigger className="w-[130px]">
                <SelectValue placeholder="Signal" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Signals</SelectItem>
                <SelectItem value="pick">Picks Only</SelectItem>
                <SelectItem value="fade">Fades Only</SelectItem>
                <SelectItem value="caution">Caution</SelectItem>
              </SelectContent>
            </Select>

            <Button variant="outline" size="icon" onClick={handleRefresh} disabled={refreshing}>
              <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
            </Button>
          </div>
          
          <p className="text-xs text-muted-foreground">
            Showing {filteredProps.length} of {props.length} analyzed props
          </p>
        </CardContent>
      </Card>

      {/* Tabbed View */}
      <Tabs defaultValue="all" className="w-full">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="all">All ({filteredProps.length})</TabsTrigger>
          <TabsTrigger value="picks" className="text-green-400">
            Picks ({pickProps.length})
          </TabsTrigger>
          <TabsTrigger value="fades" className="text-red-400">
            Fades ({fadeProps.length})
          </TabsTrigger>
          <TabsTrigger value="caution" className="text-yellow-400">
            Caution ({cautionProps.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="all" className="mt-4">
          {filteredProps.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <Zap className="w-12 h-12 mx-auto mb-3 text-muted-foreground/50" />
                <p className="text-muted-foreground">No analyzed props found</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Props will appear here after GOD MODE analysis
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="flex flex-col gap-5 w-full items-stretch">
              {filteredProps.map((prop, index) => (
                <motion.div
                  key={prop.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.03 }}
                  className="w-full self-stretch"
                >
                  <GodModePropCard prop={prop} />
                </motion.div>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="picks" className="mt-4">
          <div className="flex flex-col gap-5 w-full items-stretch">
            {pickProps.map((prop, index) => (
              <motion.div
                key={prop.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.03 }}
                className="w-full self-stretch"
              >
                <GodModePropCard prop={prop} />
              </motion.div>
            ))}
          </div>
          {pickProps.length === 0 && (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                No pick signals found
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="fades" className="mt-4">
          <div className="flex flex-col gap-5 w-full items-stretch">
            {fadeProps.map((prop, index) => (
              <motion.div
                key={prop.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.03 }}
                className="w-full self-stretch"
              >
                <GodModePropCard prop={prop} />
              </motion.div>
            ))}
          </div>
          {fadeProps.length === 0 && (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                No fade signals found
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="caution" className="mt-4">
          <div className="flex flex-col gap-5 w-full items-stretch">
            {cautionProps.map((prop, index) => (
              <motion.div
                key={prop.id}
                className="w-full self-stretch"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05 }}
              >
                <GodModePropCard prop={prop} />
              </motion.div>
            ))}
          </div>
          {cautionProps.length === 0 && (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                No caution signals found
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
