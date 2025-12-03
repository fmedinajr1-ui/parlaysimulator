import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Plus, RefreshCw, Target, TrendingUp, TrendingDown, AlertTriangle, Check, X, Loader2, Brain, Scan } from 'lucide-react';

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

export default function SharpLineCalculator() {
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

  useEffect(() => {
    fetchTrackedProps();
  }, []);

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

  const handleFetchAllOdds = async () => {
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
  };

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
              {/* Fetch All Button */}
              {trackedProps.filter(p => p.status === 'pending' && p.event_id).length > 0 && (
                <Card className="bg-primary/5 border-primary/20">
                  <CardContent className="py-3">
                    <div className="flex items-center justify-between">
                      <div className="text-sm">
                        <span className="font-medium">{trackedProps.filter(p => p.status === 'pending' && p.event_id).length}</span>
                        <span className="text-muted-foreground"> pending props ready to fetch</span>
                      </div>
                      <Button 
                        onClick={handleFetchAllOdds} 
                        disabled={fetchingAll}
                        size="sm"
                      >
                        {fetchingAll ? (
                          <>
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            Fetching {fetchProgress.current}/{fetchProgress.total}...
                          </>
                        ) : (
                          <>
                            <RefreshCw className="w-4 h-4 mr-2" />
                            Fetch All Odds
                          </>
                        )}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )}

              {trackedProps.map((prop) => (
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
                  {/* Opening vs Current Odds */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-3 rounded-lg bg-muted/30">
                      <p className="text-xs text-muted-foreground mb-1">Opening</p>
                      <p className="font-mono font-semibold">
                        O {formatPrice(prop.opening_over_price)} / U {formatPrice(prop.opening_under_price)}
                      </p>
                    </div>
                    <div className="p-3 rounded-lg bg-muted/30">
                      <p className="text-xs text-muted-foreground mb-1">Current</p>
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
                    </div>
                  )}

                  {/* AI Analysis */}
                  {prop.ai_reasoning && (
                    <div className="p-4 rounded-lg bg-primary/5 border border-primary/20 space-y-3">
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <div className="flex items-center gap-2">
                          <Brain className="w-5 h-5 text-primary" />
                          <span className="font-semibold">AI Analysis</span>
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                          {/* Calibration Badge */}
                          {prop.ai_reasoning?.includes('[Calibration:') && (
                            <Badge variant="outline" className="bg-purple-500/20 text-purple-400 border-purple-500/30">
                              <Target className="w-3 h-3 mr-1" />
                              Calibrated
                            </Badge>
                          )}
                          {prop.ai_confidence && (
                            <Badge variant="outline">
                              {Math.round(prop.ai_confidence * 100)}% confidence
                            </Badge>
                          )}
                        </div>
                      </div>
                      <p className="text-sm">{prop.ai_reasoning}</p>
                      
                      {prop.ai_signals && (() => {
                        const signals = prop.ai_signals as { sharp?: string[]; trap?: string[]; calibrationApplied?: boolean; strategyBoost?: number };
                        return (
                          <div className="space-y-2">
                            {/* Calibration Info */}
                            {signals.calibrationApplied && (
                              <div className="flex items-center gap-2 p-2 rounded bg-purple-500/10 border border-purple-500/20">
                                <Target className="w-4 h-4 text-purple-400" />
                                <span className="text-xs text-purple-400">
                                  AI calibration applied based on historical accuracy data
                                  {signals.strategyBoost && signals.strategyBoost !== 0 && (
                                    <span className="ml-2">
                                      • Strategy boost: {signals.strategyBoost > 0 ? '+' : ''}{signals.strategyBoost.toFixed(1)}
                                    </span>
                                  )}
                                </span>
                              </div>
                            )}
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
}
