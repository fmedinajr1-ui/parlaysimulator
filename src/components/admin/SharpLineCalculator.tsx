import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Plus, RefreshCw, Target, TrendingUp, TrendingDown, AlertTriangle, Check, X, Loader2, Brain, Scan, Search, ArrowUpDown, ArrowUp, ArrowDown, Timer, TimerOff, Clock, Zap, ShoppingCart } from 'lucide-react';
import { useParlayBuilder } from '@/contexts/ParlayBuilderContext';
import { Switch } from '@/components/ui/switch';
import { GodModePressureGauge } from './GodModePressureGauge';
import { ConsensusHeatmap } from './ConsensusHeatmap';

type SortField = 'player_name' | 'ai_confidence' | 'movement' | 'created_at' | 'last_updated';
type SortDirection = 'asc' | 'desc';

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
  opening_time: string;
  current_line: number | null;
  current_over_price: number | null;
  current_under_price: number | null;
  last_updated: string | null;
  line_movement: number | null;
  price_movement_over: number | null;
  price_movement_under: number | null;
  ai_recommendation: string | null;
  ai_direction: string | null;
  ai_confidence: number | null;
  ai_reasoning: string | null;
  ai_signals: unknown;
  status: string;
  input_method: string;
  commence_time: string | null;
  created_at: string;
}

const PROP_TYPES = [
  'points', 'rebounds', 'assists', 'threes', 'blocks', 'steals',
  'pts+reb', 'pts+ast', 'reb+ast', 'pts+reb+ast',
  'passing_yards', 'rushing_yards', 'receiving_yards', 'touchdowns', 'completions', 'receptions'
];

const BOOKMAKERS = ['draftkings', 'fanduel', 'betmgm', 'caesars', 'pointsbet', 'bet365'];

const SharpLineCalculator = () => {
  const { addLeg, hasLeg } = useParlayBuilder();
  const [trackedProps, setTrackedProps] = useState<TrackedProp[]>([]);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  
  // Form state
  const [sport, setSport] = useState('basketball_nba');
  const [playerName, setPlayerName] = useState('');
  const [propType, setPropType] = useState('points');
  const [gameDescription, setGameDescription] = useState('');
  const [bookmaker, setBookmaker] = useState('draftkings');
  const [openingLine, setOpeningLine] = useState('');
  const [openingOver, setOpeningOver] = useState('-110');
  const [openingUnder, setOpeningUnder] = useState('-110');
  
  // Update form state
  const [updateId, setUpdateId] = useState<string | null>(null);
  const [currentOver, setCurrentOver] = useState('');
  const [currentUnder, setCurrentUnder] = useState('');
  const [currentLine, setCurrentLine] = useState('');
  const [fetchingOdds, setFetchingOdds] = useState<string | null>(null);
  const [fetchingAll, setFetchingAll] = useState(false);
  const [fetchProgress, setFetchProgress] = useState({ current: 0, total: 0 });

  // Auto-analyze state
  const [autoAnalyze, setAutoAnalyze] = useState(false);
  const [analyzingAll, setAnalyzingAll] = useState(false);
  const [analyzeProgress, setAnalyzeProgress] = useState({ current: 0, total: 0 });

  // Search, Filter & Sort state
  const [searchQuery, setSearchQuery] = useState('');
  const [sportFilter, setSportFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [recFilter, setRecFilter] = useState('all');
  const [propTypeFilter, setPropTypeFilter] = useState('all');
  const [sortField, setSortField] = useState<SortField>('created_at');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  // Auto-refresh state
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [refreshInterval, setRefreshInterval] = useState(60); // seconds
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [nextRefreshIn, setNextRefreshIn] = useState<number>(0);

  // Filtered and sorted props
  const filteredAndSortedProps = useMemo(() => {
    let result = trackedProps.filter(prop => {
      const matchesSearch = !searchQuery || 
        prop.player_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        prop.game_description.toLowerCase().includes(searchQuery.toLowerCase()) ||
        prop.prop_type.toLowerCase().includes(searchQuery.toLowerCase()) ||
        prop.bookmaker.toLowerCase().includes(searchQuery.toLowerCase());
      
      const matchesSport = sportFilter === 'all' || prop.sport === sportFilter;
      const matchesStatus = statusFilter === 'all' || prop.status === statusFilter;
      const matchesRec = recFilter === 'all' || prop.ai_recommendation === recFilter;
      const matchesPropType = propTypeFilter === 'all' || prop.prop_type === propTypeFilter;
      
      return matchesSearch && matchesSport && matchesStatus && matchesRec && matchesPropType;
    });

    result.sort((a, b) => {
      let comparison = 0;
      
      switch (sortField) {
        case 'player_name':
          comparison = a.player_name.localeCompare(b.player_name);
          break;
        case 'ai_confidence':
          const confA = a.ai_confidence ?? -1;
          const confB = b.ai_confidence ?? -1;
          comparison = confB - confA;
          break;
        case 'movement':
          const moveA = Math.abs(a.price_movement_over ?? 0);
          const moveB = Math.abs(b.price_movement_over ?? 0);
          comparison = moveB - moveA;
          break;
        case 'created_at':
          comparison = new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
          break;
        case 'last_updated':
          const updA = a.last_updated ? new Date(a.last_updated).getTime() : 0;
          const updB = b.last_updated ? new Date(b.last_updated).getTime() : 0;
          comparison = updB - updA;
          break;
      }
      
      return sortDirection === 'desc' ? comparison : -comparison;
    });

    return result;
  }, [trackedProps, searchQuery, sportFilter, statusFilter, recFilter, propTypeFilter, sortField, sortDirection]);

  const pendingFilteredProps = filteredAndSortedProps.filter(p => p.status === 'pending' && p.event_id);
  const propsReadyToAnalyze = filteredAndSortedProps.filter(
    p => p.current_over_price && p.current_under_price && !p.ai_recommendation
  );

  useEffect(() => {
    fetchTrackedProps();
  }, []);

  // Auto-refresh ref to avoid stale closures
  const fetchAllOddsRef = useRef<(() => Promise<void>) | null>(null);
  const analyzeAllRef = useRef<(() => Promise<void>) | null>(null);

  // Auto-refresh effect
  useEffect(() => {
    if (!autoRefresh) {
      setNextRefreshIn(0);
      return;
    }

    const pendingProps = trackedProps.filter(p => p.status === 'pending' && p.event_id);
    if (pendingProps.length === 0) {
      setAutoRefresh(false);
      toast.info('Auto-refresh disabled: No pending props with event IDs');
      return;
    }

    setNextRefreshIn(refreshInterval);

    const countdownInterval = setInterval(() => {
      setNextRefreshIn(prev => {
        if (prev <= 1) return refreshInterval;
        return prev - 1;
      });
    }, 1000);

    const refreshTimer = setInterval(async () => {
      if (fetchAllOddsRef.current) {
        toast.info('Auto-refreshing odds...');
        await fetchAllOddsRef.current();
        setLastRefresh(new Date());
        
        // Auto-analyze after fetching if enabled
        if (autoAnalyze && analyzeAllRef.current) {
          toast.info('Auto-analyzing props...');
          await analyzeAllRef.current();
        }
      }
    }, refreshInterval * 1000);

    return () => {
      clearInterval(countdownInterval);
      clearInterval(refreshTimer);
    };
  }, [autoRefresh, refreshInterval, trackedProps.length, autoAnalyze]);

  const fetchTrackedProps = async () => {
    try {
      const { data, error } = await supabase
        .from('sharp_line_tracker')
        .select('*')
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      setTrackedProps((data || []) as unknown as TrackedProp[]);
    } catch (error) {
      console.error('Error fetching tracked props:', error);
      toast.error('Failed to fetch tracked props');
    } finally {
      setLoading(false);
    }
  };

  const handleAddProp = async () => {
    if (!playerName || !gameDescription || !openingLine) {
      toast.error('Please fill in all required fields');
      return;
    }

    try {
      const { error } = await supabase
        .from('sharp_line_tracker')
        .insert({
          sport,
          player_name: playerName,
          prop_type: propType,
          game_description: gameDescription,
          bookmaker,
          opening_line: parseFloat(openingLine),
          opening_over_price: parseFloat(openingOver),
          opening_under_price: parseFloat(openingUnder),
          input_method: 'manual',
          status: 'pending'
        });

      if (error) throw error;

      toast.success('Prop added successfully');
      resetForm();
      fetchTrackedProps();
    } catch (error) {
      console.error('Error adding prop:', error);
      toast.error('Failed to add prop');
    }
  };

  const resetForm = () => {
    setPlayerName('');
    setGameDescription('');
    setOpeningLine('');
    setOpeningOver('-110');
    setOpeningUnder('-110');
  };

  const handleUpdateOdds = async (id: string) => {
    if (!currentOver || !currentUnder) {
      toast.error('Please enter current odds');
      return;
    }

    try {
      const updateData: Record<string, unknown> = {
        current_over_price: parseFloat(currentOver),
        current_under_price: parseFloat(currentUnder),
        last_updated: new Date().toISOString(),
        status: 'updated'
      };

      if (currentLine) {
        updateData.current_line = parseFloat(currentLine);
      }

      const { error } = await supabase
        .from('sharp_line_tracker')
        .update(updateData)
        .eq('id', id);

      if (error) throw error;

      toast.success('Odds updated');
      setUpdateId(null);
      setCurrentOver('');
      setCurrentUnder('');
      setCurrentLine('');
      fetchTrackedProps();
    } catch (error) {
      console.error('Error updating odds:', error);
      toast.error('Failed to update odds');
    }
  };

  const handleAnalyze = async (prop: TrackedProp) => {
    if (!prop.current_over_price || !prop.current_under_price) {
      toast.error('Please update current odds first');
      return;
    }

    setAnalyzing(prop.id);

    try {
      const { data, error } = await supabase.functions.invoke('analyze-sharp-line', {
        body: {
          id: prop.id,
          opening_line: prop.opening_line,
          opening_over_price: prop.opening_over_price,
          opening_under_price: prop.opening_under_price,
          current_line: prop.current_line || prop.opening_line,
          current_over_price: prop.current_over_price,
          current_under_price: prop.current_under_price,
          sport: prop.sport,
          prop_type: prop.prop_type,
          commence_time: prop.commence_time
        }
      });

      if (error) throw error;

      toast.success(`Analysis complete: ${data.recommendation.toUpperCase()} the ${data.direction.toUpperCase()}`);
      fetchTrackedProps();
    } catch (error) {
      console.error('Error analyzing:', error);
      toast.error('Failed to analyze prop');
    } finally {
      setAnalyzing(null);
    }
  };

  const handleScanProps = async () => {
    setScanning(true);
    try {
      const { data, error } = await supabase.functions.invoke('scan-opening-lines', {
        body: { sports: ['basketball_nba', 'americanfootball_nfl'] }
      });

      if (error) throw error;

      toast.success(`Scanned ${data?.count || 0} props`);
      fetchTrackedProps();
    } catch (error) {
      console.error('Error scanning props:', error);
      toast.error('Failed to scan props');
    } finally {
      setScanning(false);
    }
  };

  const handleFetchCurrentOdds = async (prop: TrackedProp) => {
    if (!prop.event_id) {
      toast.error('No event ID - cannot fetch odds');
      return;
    }

    setFetchingOdds(prop.id);

    try {
      const { data, error } = await supabase.functions.invoke('fetch-current-odds', {
        body: {
          event_id: prop.event_id,
          sport: prop.sport,
          player_name: prop.player_name,
          prop_type: prop.prop_type,
          bookmaker: prop.bookmaker
        }
      });

      if (error) throw error;

      if (!data.success) {
        toast.error(data.error || 'Failed to fetch odds');
        return;
      }

      // Update the database with fetched odds
      const { error: updateError } = await supabase
        .from('sharp_line_tracker')
        .update({
          current_over_price: data.odds.over_price,
          current_under_price: data.odds.under_price,
          current_line: data.odds.line,
          last_updated: new Date().toISOString(),
          status: 'updated'
        })
        .eq('id', prop.id);

      if (updateError) throw updateError;

      toast.success(`Fetched: O ${data.odds.over_price > 0 ? '+' : ''}${data.odds.over_price} / U ${data.odds.under_price > 0 ? '+' : ''}${data.odds.under_price}`);
      fetchTrackedProps();
    } catch (error) {
      console.error('Error fetching current odds:', error);
      toast.error('Failed to fetch current odds');
    } finally {
      setFetchingOdds(null);
    }
  };

  const handleFetchAllOdds = useCallback(async () => {
    const pendingProps = trackedProps.filter(p => p.status === 'pending' && p.event_id);
    
    if (pendingProps.length === 0) {
      toast.error('No pending props with event IDs to fetch');
      return;
    }

    setFetchingAll(true);
    setFetchProgress({ current: 0, total: pendingProps.length });

    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < pendingProps.length; i++) {
      const prop = pendingProps[i];
      setFetchProgress({ current: i + 1, total: pendingProps.length });

      try {
        const { data, error } = await supabase.functions.invoke('fetch-current-odds', {
          body: {
            event_id: prop.event_id,
            sport: prop.sport,
            player_name: prop.player_name,
            prop_type: prop.prop_type,
            bookmaker: prop.bookmaker
          }
        });

        if (error || !data.success) {
          failCount++;
          continue;
        }

        await supabase
          .from('sharp_line_tracker')
          .update({
            current_over_price: data.odds.over_price,
            current_under_price: data.odds.under_price,
            current_line: data.odds.line,
            last_updated: new Date().toISOString(),
            status: 'updated'
          })
          .eq('id', prop.id);

        successCount++;
      } catch (err) {
        console.error(`Error fetching odds for ${prop.player_name}:`, err);
        failCount++;
      }

      // Small delay to avoid rate limiting
      if (i < pendingProps.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 300));
      }
    }

    setFetchingAll(false);
    setFetchProgress({ current: 0, total: 0 });
    fetchTrackedProps();

    if (successCount > 0) {
      toast.success(`Updated ${successCount} props${failCount > 0 ? `, ${failCount} failed` : ''}`);
    } else {
      toast.error(`Failed to fetch all ${failCount} props`);
    }
  }, [trackedProps]);

  const handleAnalyzeAll = useCallback(async () => {
    const propsToAnalyze = trackedProps.filter(
      p => p.current_over_price && p.current_under_price && !p.ai_recommendation
    );
    
    if (propsToAnalyze.length === 0) {
      toast.info('No props ready to analyze');
      return;
    }

    setAnalyzingAll(true);
    setAnalyzeProgress({ current: 0, total: propsToAnalyze.length });

    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < propsToAnalyze.length; i++) {
      const prop = propsToAnalyze[i];
      setAnalyzeProgress({ current: i + 1, total: propsToAnalyze.length });

      try {
        const { error } = await supabase.functions.invoke('analyze-sharp-line', {
          body: {
            id: prop.id,
            opening_line: prop.opening_line,
            opening_over_price: prop.opening_over_price,
            opening_under_price: prop.opening_under_price,
            current_line: prop.current_line || prop.opening_line,
            current_over_price: prop.current_over_price,
            current_under_price: prop.current_under_price,
            sport: prop.sport,
            prop_type: prop.prop_type,
            commence_time: prop.commence_time
          }
        });

        if (error) {
          failCount++;
        } else {
          successCount++;
        }
      } catch (err) {
        console.error(`Error analyzing ${prop.player_name}:`, err);
        failCount++;
      }

      // Rate limit delay
      if (i < propsToAnalyze.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    setAnalyzingAll(false);
    setAnalyzeProgress({ current: 0, total: 0 });
    fetchTrackedProps();

    if (successCount > 0) {
      toast.success(`Analyzed ${successCount} props${failCount > 0 ? `, ${failCount} failed` : ''}`);
    } else if (failCount > 0) {
      toast.error(`Failed to analyze ${failCount} props`);
    }
  }, [trackedProps]);

  // Keep refs updated for auto-refresh
  useEffect(() => {
    fetchAllOddsRef.current = handleFetchAllOdds;
    analyzeAllRef.current = handleAnalyzeAll;
  }, [handleFetchAllOdds, handleAnalyzeAll]);

  const handleDeleteProp = async (id: string) => {
    try {
      const { error } = await supabase
        .from('sharp_line_tracker')
        .delete()
        .eq('id', id);

      if (error) throw error;

      toast.success('Prop deleted');
      fetchTrackedProps();
    } catch (error) {
      console.error('Error deleting prop:', error);
      toast.error('Failed to delete prop');
    }
  };

  const getRecommendationBadge = (rec: string | null, direction: string | null) => {
    if (!rec) return null;
    
    const colors: Record<string, string> = {
      pick: 'bg-green-500/20 text-green-400 border-green-500/30',
      fade: 'bg-red-500/20 text-red-400 border-red-500/30',
      caution: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30'
    };
    
    const icons: Record<string, React.ReactNode> = {
      pick: <Check className="w-3 h-3" />,
      fade: <X className="w-3 h-3" />,
      caution: <AlertTriangle className="w-3 h-3" />
    };

    return (
      <Badge className={`${colors[rec]} flex items-center gap-1`}>
        {icons[rec]}
        {rec.toUpperCase()} {direction ? `THE ${direction.toUpperCase()}` : ''}
      </Badge>
    );
  };

  const getStatusBadge = (status: string) => {
    const styles: Record<string, string> = {
      pending: 'bg-muted text-muted-foreground',
      updated: 'bg-blue-500/20 text-blue-400',
      analyzed: 'bg-green-500/20 text-green-400',
      locked: 'bg-purple-500/20 text-purple-400'
    };
    
    return <Badge variant="outline" className={styles[status]}>{status}</Badge>;
  };

  const formatPrice = (price: number) => {
    return price > 0 ? `+${price}` : price.toString();
  };

  const formatTimestamp = (dateString: string | null) => {
    if (!dateString) return null;
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const getFreshnessColor = (dateString: string | null) => {
    if (!dateString) return 'text-muted-foreground';
    const diffMins = (Date.now() - new Date(dateString).getTime()) / 60000;
    if (diffMins < 15) return 'text-green-400';
    if (diffMins < 60) return 'text-yellow-400';
    return 'text-red-400';
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Tabs defaultValue="add" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="add">Add Prop</TabsTrigger>
          <TabsTrigger value="tracked">Tracked Props ({trackedProps.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="add" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Plus className="w-5 h-5" />
                Add Opening Lines
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Sport</Label>
                  <Select value={sport} onValueChange={setSport}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="basketball_nba">NBA</SelectItem>
                      <SelectItem value="americanfootball_nfl">NFL</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Prop Type</Label>
                  <Select value={propType} onValueChange={setPropType}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PROP_TYPES.map(pt => (
                        <SelectItem key={pt} value={pt}>{pt}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Player Name</Label>
                  <Input
                    value={playerName}
                    onChange={(e) => setPlayerName(e.target.value)}
                    placeholder="LeBron James"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Game</Label>
                  <Input
                    value={gameDescription}
                    onChange={(e) => setGameDescription(e.target.value)}
                    placeholder="LAL @ BOS"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Bookmaker</Label>
                  <Select value={bookmaker} onValueChange={setBookmaker}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {BOOKMAKERS.map(b => (
                        <SelectItem key={b} value={b}>{b}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Opening Line</Label>
                  <Input
                    type="number"
                    step="0.5"
                    value={openingLine}
                    onChange={(e) => setOpeningLine(e.target.value)}
                    placeholder="25.5"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Opening Over Price</Label>
                  <Input
                    type="number"
                    value={openingOver}
                    onChange={(e) => setOpeningOver(e.target.value)}
                    placeholder="-110"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Opening Under Price</Label>
                  <Input
                    type="number"
                    value={openingUnder}
                    onChange={(e) => setOpeningUnder(e.target.value)}
                    placeholder="-110"
                  />
                </div>
              </div>

              <div className="flex gap-2">
                <Button onClick={handleAddProp} className="flex-1">
                  <Plus className="w-4 h-4 mr-2" />
                  Add Prop
                </Button>
                <Button variant="outline" onClick={handleScanProps} disabled={scanning}>
                  {scanning ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Scan className="w-4 h-4 mr-2" />
                  )}
                  Scan Today's Props
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="tracked" className="space-y-4">
          {trackedProps.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                No props being tracked. Add props to get started.
              </CardContent>
            </Card>
          ) : (
            <>
              {/* Fetch All & Analyze All Controls */}
              <Card className="bg-primary/5 border-primary/20">
                <CardContent className="py-3 space-y-3">
                  {/* Action Buttons Row */}
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex flex-col gap-1 text-sm">
                      <div>
                        <span className="font-medium">{pendingFilteredProps.length}</span>
                        <span className="text-muted-foreground"> pending to fetch</span>
                      </div>
                      <div>
                        <span className="font-medium text-primary">{propsReadyToAnalyze.length}</span>
                        <span className="text-muted-foreground"> ready to analyze</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button 
                        onClick={handleFetchAllOdds} 
                        disabled={fetchingAll || analyzingAll || pendingFilteredProps.length === 0}
                        size="sm"
                        variant="outline"
                      >
                        {fetchingAll ? (
                          <>
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            {fetchProgress.current}/{fetchProgress.total}
                          </>
                        ) : (
                          <>
                            <RefreshCw className="w-4 h-4 mr-2" />
                            Fetch All
                          </>
                        )}
                      </Button>
                      <Button 
                        onClick={handleAnalyzeAll} 
                        disabled={analyzingAll || fetchingAll || propsReadyToAnalyze.length === 0}
                        size="sm"
                      >
                        {analyzingAll ? (
                          <>
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            {analyzeProgress.current}/{analyzeProgress.total}
                          </>
                        ) : (
                          <>
                            <Brain className="w-4 h-4 mr-2" />
                            Analyze All
                          </>
                        )}
                      </Button>
                    </div>
                  </div>
                  
                  {/* Auto-Refresh & Auto-Analyze Controls */}
                  <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
                    <div className="flex flex-wrap items-center gap-4">
                      {/* Auto-Refresh Toggle */}
                      <div className="flex items-center gap-2">
                        {autoRefresh ? (
                          <Timer className="w-4 h-4 text-green-500" />
                        ) : (
                          <TimerOff className="w-4 h-4 text-muted-foreground" />
                        )}
                        <Label htmlFor="auto-refresh" className="text-sm cursor-pointer">
                          Auto-refresh
                        </Label>
                        <Switch
                          id="auto-refresh"
                          checked={autoRefresh}
                          onCheckedChange={setAutoRefresh}
                          disabled={pendingFilteredProps.length === 0}
                        />
                      </div>
                      
                      {autoRefresh && (
                        <Select 
                          value={refreshInterval.toString()} 
                          onValueChange={(v) => setRefreshInterval(parseInt(v))}
                        >
                          <SelectTrigger className="w-[110px] h-8">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="30">30 sec</SelectItem>
                            <SelectItem value="60">1 min</SelectItem>
                            <SelectItem value="120">2 min</SelectItem>
                            <SelectItem value="300">5 min</SelectItem>
                            <SelectItem value="1800">30 min</SelectItem>
                            <SelectItem value="3600">1 hour</SelectItem>
                            <SelectItem value="7200">2 hours</SelectItem>
                            <SelectItem value="10800">3 hours</SelectItem>
                            <SelectItem value="21600">6 hours</SelectItem>
                          </SelectContent>
                        </Select>
                      )}

                      {/* Auto-Analyze Toggle */}
                      <div className="flex items-center gap-2 border-l border-border pl-4">
                        {autoAnalyze ? (
                          <Brain className="w-4 h-4 text-primary" />
                        ) : (
                          <Brain className="w-4 h-4 text-muted-foreground" />
                        )}
                        <Label htmlFor="auto-analyze" className="text-sm cursor-pointer">
                          Auto-analyze
                        </Label>
                        <Switch
                          id="auto-analyze"
                          checked={autoAnalyze}
                          onCheckedChange={setAutoAnalyze}
                          disabled={!autoRefresh}
                        />
                      </div>
                    </div>
                    
                    {autoRefresh && (
                      <div className="text-xs text-muted-foreground">
                        Next in <span className="font-mono text-foreground">
                          {nextRefreshIn >= 3600 
                            ? `${Math.floor(nextRefreshIn / 3600)}h ${Math.floor((nextRefreshIn % 3600) / 60)}m`
                            : nextRefreshIn >= 60 
                              ? `${Math.floor(nextRefreshIn / 60)}m ${nextRefreshIn % 60}s`
                              : `${nextRefreshIn}s`
                          }
                        </span>
                        {autoAnalyze && <span className="text-primary ml-1">+ analyze</span>}
                        {lastRefresh && (
                          <span className="ml-2">
                            (Last: {lastRefresh.toLocaleTimeString()})
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Search, Filter & Sort Toolbar */}
              <Card className="bg-card/50">
                <CardContent className="py-4 space-y-4">
                  {/* Search Bar */}
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      placeholder="Search players, games, props..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-10 pr-10"
                    />
                    {searchQuery && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 p-0"
                        onClick={() => setSearchQuery('')}
                      >
                        <X className="w-4 h-4" />
                      </Button>
                    )}
                  </div>

                  {/* Filters Row */}
                  <div className="flex flex-wrap gap-2">
                    <Select value={sportFilter} onValueChange={setSportFilter}>
                      <SelectTrigger className="w-[120px]">
                        <SelectValue placeholder="Sport" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Sports</SelectItem>
                        <SelectItem value="basketball_nba">NBA</SelectItem>
                        <SelectItem value="americanfootball_nfl">NFL</SelectItem>
                      </SelectContent>
                    </Select>

                    <Select value={statusFilter} onValueChange={setStatusFilter}>
                      <SelectTrigger className="w-[120px]">
                        <SelectValue placeholder="Status" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Status</SelectItem>
                        <SelectItem value="pending">Pending</SelectItem>
                        <SelectItem value="updated">Updated</SelectItem>
                        <SelectItem value="analyzed">Analyzed</SelectItem>
                      </SelectContent>
                    </Select>

                    <Select value={recFilter} onValueChange={setRecFilter}>
                      <SelectTrigger className="w-[140px]">
                        <SelectValue placeholder="Recommendation" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Recs</SelectItem>
                        <SelectItem value="pick">✅ Pick</SelectItem>
                        <SelectItem value="fade">❌ Fade</SelectItem>
                        <SelectItem value="caution">⚠️ Caution</SelectItem>
                      </SelectContent>
                    </Select>

                    <Select value={propTypeFilter} onValueChange={setPropTypeFilter}>
                      <SelectTrigger className="w-[130px]">
                        <SelectValue placeholder="Prop Type" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Props</SelectItem>
                        {PROP_TYPES.map(pt => (
                          <SelectItem key={pt} value={pt}>{pt}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Sort Row */}
                  <div className="flex items-center justify-between border-t border-border pt-4">
                    <div className="flex items-center gap-2">
                      <ArrowUpDown className="w-4 h-4 text-muted-foreground" />
                      <span className="text-sm text-muted-foreground">Sort by:</span>
                      <Select 
                        value={sortField} 
                        onValueChange={(v) => {
                          setSortField(v as SortField);
                          if (v === 'player_name') setSortDirection('asc');
                          else setSortDirection('desc');
                        }}
                      >
                        <SelectTrigger className="w-[150px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="created_at">📅 Date Added</SelectItem>
                          <SelectItem value="last_updated">🕐 Last Fetched</SelectItem>
                          <SelectItem value="player_name">🔤 Player Name</SelectItem>
                          <SelectItem value="ai_confidence">📊 Confidence</SelectItem>
                          <SelectItem value="movement">📈 Movement</SelectItem>
                        </SelectContent>
                      </Select>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setSortDirection(d => d === 'asc' ? 'desc' : 'asc')}
                        className="px-2"
                      >
                        {sortDirection === 'desc' ? (
                          <ArrowDown className="w-4 h-4" />
                        ) : (
                          <ArrowUp className="w-4 h-4" />
                        )}
                      </Button>
                    </div>

                    {/* Results Count */}
                    <div className="text-sm text-muted-foreground">
                      Showing <span className="font-medium text-foreground">{filteredAndSortedProps.length}</span> of {trackedProps.length} props
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* No Results Message */}
              {filteredAndSortedProps.length === 0 && trackedProps.length > 0 && (
                <Card>
                  <CardContent className="py-8 text-center">
                    <Search className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
                    <p className="text-muted-foreground">No props match your filters</p>
                    <Button
                      variant="link"
                      onClick={() => {
                        setSearchQuery('');
                        setSportFilter('all');
                        setStatusFilter('all');
                        setRecFilter('all');
                        setPropTypeFilter('all');
                      }}
                    >
                      Clear all filters
                    </Button>
                  </CardContent>
                </Card>
              )}

              {filteredAndSortedProps.map((prop) => (
              <Card key={prop.id} className="overflow-hidden">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-lg flex items-center gap-2">
                        {prop.player_name} - {prop.prop_type.toUpperCase()} {prop.opening_line}
                        {getStatusBadge(prop.status)}
                      </CardTitle>
                      <p className="text-sm text-muted-foreground mt-1">
                        {prop.sport === 'basketball_nba' ? 'NBA' : 'NFL'} • {prop.game_description} • {prop.bookmaker}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {prop.ai_recommendation && getRecommendationBadge(prop.ai_recommendation, prop.ai_direction)}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDeleteProp(prop.id)}
                        className="text-destructive hover:text-destructive"
                      >
                        <X className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Timestamps Row */}
                  <div className="flex flex-wrap gap-4 text-xs border-b border-border pb-3">
                    <div className="flex items-center gap-1">
                      <Clock className="w-3 h-3 text-muted-foreground" />
                      <span className="text-muted-foreground">Last Fetched:</span>
                      <span className={`font-medium ${getFreshnessColor(prop.last_updated)}`}>
                        {formatTimestamp(prop.last_updated) || 'Never'}
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-muted-foreground">Opening:</span>
                      <span className="text-foreground">{formatTimestamp(prop.opening_time) || formatTimestamp(prop.created_at)}</span>
                    </div>
                    {prop.commence_time && (
                      <div className="flex items-center gap-1">
                        <span className="text-muted-foreground">Game:</span>
                        <span className="text-foreground">
                          {new Date(prop.commence_time).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Opening vs Current Odds */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-3 rounded-lg bg-muted/30">
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-xs text-muted-foreground">Opening</p>
                        <p className="text-xs text-muted-foreground">{formatTimestamp(prop.opening_time) || ''}</p>
                      </div>
                      <p className="font-mono font-semibold">
                        O {formatPrice(prop.opening_over_price)} / U {formatPrice(prop.opening_under_price)}
                      </p>
                    </div>
                    <div className="p-3 rounded-lg bg-muted/30">
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-xs text-muted-foreground">Current</p>
                        <p className={`text-xs ${getFreshnessColor(prop.last_updated)}`}>
                          {formatTimestamp(prop.last_updated) || ''}
                        </p>
                      </div>
                      {prop.current_over_price ? (
                        <p className="font-mono font-semibold">
                          O {formatPrice(prop.current_over_price)} / U {formatPrice(prop.current_under_price!)}
                        </p>
                      ) : (
                        <p className="text-muted-foreground text-sm">Not updated</p>
                      )}
                    </div>
                  </div>

                  {/* Movement Display */}
                  {prop.price_movement_over !== null && (
                    <div className="flex items-center gap-4 p-3 rounded-lg bg-muted/20">
                      <div className="flex items-center gap-2">
                        {prop.price_movement_over! < 0 ? (
                          <TrendingDown className="w-4 h-4 text-green-400" />
                        ) : (
                          <TrendingUp className="w-4 h-4 text-red-400" />
                        )}
                        <span className="text-sm">
                          Over moved {prop.price_movement_over! > 0 ? '+' : ''}{prop.price_movement_over} pts
                        </span>
                      </div>
                      {prop.line_movement !== null && prop.line_movement !== 0 && (
                        <div className="text-sm text-muted-foreground">
                          Line: {prop.opening_line} → {prop.current_line} ({prop.line_movement! > 0 ? '+' : ''}{prop.line_movement})
                        </div>
                      )}
                    </div>
                  )}

                  {/* Update Form */}
                  {updateId === prop.id ? (
                    <div className="space-y-3 p-3 rounded-lg border border-border">
                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <Label className="text-xs">Current Over</Label>
                          <Input
                            type="number"
                            value={currentOver}
                            onChange={(e) => setCurrentOver(e.target.value)}
                            placeholder="-115"
                          />
                        </div>
                        <div>
                          <Label className="text-xs">Current Under</Label>
                          <Input
                            type="number"
                            value={currentUnder}
                            onChange={(e) => setCurrentUnder(e.target.value)}
                            placeholder="-105"
                          />
                        </div>
                        <div>
                          <Label className="text-xs">Current Line (opt)</Label>
                          <Input
                            type="number"
                            step="0.5"
                            value={currentLine}
                            onChange={(e) => setCurrentLine(e.target.value)}
                            placeholder={prop.opening_line.toString()}
                          />
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button size="sm" onClick={() => handleUpdateOdds(prop.id)}>
                          Save
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setUpdateId(null)}>
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex gap-2 flex-wrap">
                      <Button
                        size="sm"
                        variant="default"
                        onClick={() => handleFetchCurrentOdds(prop)}
                        disabled={fetchingOdds === prop.id || !prop.event_id}
                      >
                        {fetchingOdds === prop.id ? (
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        ) : (
                          <RefreshCw className="w-4 h-4 mr-2" />
                        )}
                        Fetch Current
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setUpdateId(prop.id);
                          setCurrentOver(prop.current_over_price?.toString() || '');
                          setCurrentUnder(prop.current_under_price?.toString() || '');
                          setCurrentLine(prop.current_line?.toString() || '');
                        }}
                      >
                        Manual Entry
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => handleAnalyze(prop)}
                        disabled={analyzing === prop.id || !prop.current_over_price}
                      >
                        {analyzing === prop.id ? (
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        ) : (
                          <Brain className="w-4 h-4 mr-2" />
                        )}
                        Analyze
                      </Button>
                      {prop.ai_recommendation && (() => {
                        const desc = `${prop.player_name} ${prop.ai_direction?.toUpperCase() || 'OVER'} ${prop.current_line || prop.opening_line} ${prop.prop_type}`;
                        const odds = prop.ai_direction === 'over' 
                          ? (prop.current_over_price || prop.opening_over_price)
                          : (prop.current_under_price || prop.opening_under_price);
                        const isAdded = hasLeg(desc);
                        
                        return (
                          <Button
                            size="sm"
                            variant={isAdded ? "outline" : "secondary"}
                            disabled={isAdded}
                            onClick={() => {
                              if (!isAdded) {
                                addLeg({
                                  description: desc,
                                  odds,
                                  source: 'sharp',
                                  playerName: prop.player_name,
                                  propType: prop.prop_type,
                                  line: prop.current_line || prop.opening_line,
                                  side: (prop.ai_direction as 'over' | 'under') || 'over',
                                  sport: prop.sport,
                                  eventId: prop.event_id || undefined,
                                  confidenceScore: prop.ai_confidence || undefined,
                                });
                              }
                            }}
                          >
                            {isAdded ? (
                              <>
                                <Check className="w-4 h-4 mr-2" />
                                Added
                              </>
                            ) : (
                              <>
                                <ShoppingCart className="w-4 h-4 mr-2" />
                                Add to Parlay
                              </>
                            )}
                          </Button>
                        );
                      })()}
                    </div>
                  )}

                  {/* AI Analysis - GOD MODE */}
                  {prop.ai_reasoning && (
                    <div className="p-4 rounded-lg bg-primary/5 border border-primary/20 space-y-4">
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <div className="flex items-center gap-2">
                          <Zap className="w-5 h-5 text-primary" />
                          <span className="font-semibold">GOD MODE Analysis</span>
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                          {prop.ai_confidence && (
                            <Badge variant="outline">
                              {Math.round(prop.ai_confidence * 100)}% confidence
                            </Badge>
                          )}
                        </div>
                      </div>
                      <p className="text-sm">{prop.ai_reasoning}</p>
                      
                      {/* Prominent Add to Parlay Button in GOD MODE Section */}
                      {prop.ai_recommendation && (() => {
                        const desc = `${prop.player_name} ${prop.ai_direction?.toUpperCase() || 'OVER'} ${prop.current_line || prop.opening_line} ${prop.prop_type}`;
                        const odds = prop.ai_direction === 'over' 
                          ? (prop.current_over_price || prop.opening_over_price)
                          : (prop.current_under_price || prop.opening_under_price);
                        const isAdded = hasLeg(desc);
                        const recColor = prop.ai_recommendation === 'pick' 
                          ? 'bg-green-600 hover:bg-green-700 text-white' 
                          : prop.ai_recommendation === 'fade' 
                            ? 'bg-red-600 hover:bg-red-700 text-white'
                            : 'bg-yellow-600 hover:bg-yellow-700 text-white';
                        
                        return (
                          <Button
                            className={`w-full mt-2 ${isAdded ? 'bg-muted text-muted-foreground' : recColor}`}
                            size="lg"
                            disabled={isAdded}
                            onClick={() => {
                              if (!isAdded) {
                                addLeg({
                                  description: desc,
                                  odds,
                                  source: 'sharp',
                                  playerName: prop.player_name,
                                  propType: prop.prop_type,
                                  line: prop.current_line || prop.opening_line,
                                  side: (prop.ai_direction as 'over' | 'under') || 'over',
                                  sport: prop.sport,
                                  eventId: prop.event_id || undefined,
                                  confidenceScore: prop.ai_confidence || undefined,
                                });
                              }
                            }}
                          >
                            {isAdded ? (
                              <>
                                <Check className="w-5 h-5 mr-2" />
                                Added to Parlay
                              </>
                            ) : (
                              <>
                                <ShoppingCart className="w-5 h-5 mr-2" />
                                {prop.ai_recommendation === 'pick' ? '✅ PICK' : prop.ai_recommendation === 'fade' ? '🚫 FADE' : '⚠️ CAUTION'} - Add {prop.ai_direction?.toUpperCase() || 'OVER'} to Parlay
                              </>
                            )}
                          </Button>
                        );
                      })()}
                      
                      {prop.ai_signals && (() => {
                        const signals = prop.ai_signals as {
                          godMode?: boolean;
                          sharpPressure?: number;
                          trapPressure?: number;
                          marketNoise?: number;
                          eventVolatilityModifier?: number;
                          nmes?: number;
                          sharpProbability?: number;
                          trapProbability?: number;
                          godModeScore?: number;
                          consensusRatio?: number;
                          consensusStrength?: string;
                          sharpSignals?: Array<{ name: string; baseWeight: number; contextMultiplier: number; finalWeight: number; description: string; isActive: boolean }>;
                          trapSignals?: Array<{ name: string; baseWeight: number; severityModifier: number; finalWeight: number; description: string; isActive: boolean }>;
                          sharp?: string[];
                          trap?: string[];
                        };
                        
                        // GOD MODE display
                        if (signals.godMode && signals.sharpPressure !== undefined) {
                          return (
                            <div className="space-y-4">
                              <GodModePressureGauge
                                sharpPressure={signals.sharpPressure}
                                trapPressure={signals.trapPressure || 0}
                                marketNoise={signals.marketNoise || 0}
                                eventVolatilityModifier={signals.eventVolatilityModifier || 1}
                                nmes={signals.nmes || 0}
                                sharpProbability={signals.sharpProbability || 0.5}
                                trapProbability={signals.trapProbability || 0.5}
                                godModeScore={signals.godModeScore || 0}
                                recommendation={prop.ai_recommendation as 'pick' | 'fade' | 'caution' || 'caution'}
                              />
                              
                              {signals.sharpSignals && signals.trapSignals && (
                                <ConsensusHeatmap
                                  consensusRatio={signals.consensusRatio || 0.5}
                                  consensusStrength={signals.consensusStrength || 'weak'}
                                  sharpSignals={signals.sharpSignals}
                                  trapSignals={signals.trapSignals}
                                />
                              )}
                            </div>
                          );
                        }
                        
                        // Legacy display for old analyses
                        return (
                          <div className="space-y-2">
                            {signals.sharp && signals.sharp.length > 0 && (
                              <div>
                                <p className="text-xs text-green-400 font-semibold mb-1">✅ Sharp Signals</p>
                                <div className="flex flex-wrap gap-1">
                                  {signals.sharp.map((s, i) => (
                                    <Badge key={i} variant="outline" className="text-xs bg-green-500/10">
                                      {s}
                                    </Badge>
                                  ))}
                                </div>
                              </div>
                            )}
                            {signals.trap && signals.trap.length > 0 && (
                              <div>
                                <p className="text-xs text-red-400 font-semibold mb-1">🚫 Trap Signals</p>
                                <div className="flex flex-wrap gap-1">
                                  {signals.trap.map((s, i) => (
                                    <Badge key={i} variant="outline" className="text-xs bg-red-500/10">
                                      {s}
                                    </Badge>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default SharpLineCalculator;
