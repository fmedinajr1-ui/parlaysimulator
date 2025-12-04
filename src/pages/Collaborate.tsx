import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useCollaboratorRole } from '@/hooks/useCollaboratorRole';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { 
  Loader2, 
  RefreshCw, 
  TrendingUp, 
  TrendingDown,
  Search,
  Activity,
  Target,
  DollarSign,
  AlertTriangle,
  CheckCircle,
  Clock,
  Zap
} from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';

interface TrackedProp {
  id: string;
  player_name: string;
  prop_type: string;
  game_description: string;
  sport: string;
  bookmaker: string;
  opening_line: number;
  opening_over_price: number;
  opening_under_price: number;
  current_line: number | null;
  current_over_price: number | null;
  current_under_price: number | null;
  line_movement: number | null;
  ai_direction: string | null;
  ai_confidence: number | null;
  ai_recommendation: string | null;
  commence_time: string | null;
  last_updated: string | null;
  status: string | null;
}

export default function Collaborate() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { isCollaborator, isAdmin, isLoading: isCheckingRole } = useCollaboratorRole();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedProp, setSelectedProp] = useState<TrackedProp | null>(null);

  useEffect(() => {
    if (!isCheckingRole && !isCollaborator && !isAdmin) {
      toast({
        title: "Access Denied",
        description: "You don't have collaborator privileges",
        variant: "destructive"
      });
      navigate('/');
    }
  }, [isCollaborator, isAdmin, isCheckingRole, navigate, toast]);

  // Fetch tracked props
  const { data: trackedProps, isLoading, refetch } = useQuery({
    queryKey: ['collab-tracked-props'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sharp_line_tracker')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data as TrackedProp[];
    },
    enabled: isCollaborator || isAdmin,
  });

  // Fetch current odds mutation
  const fetchOdds = useMutation({
    mutationFn: async (prop: TrackedProp) => {
      const { data, error } = await supabase.functions.invoke('fetch-current-odds', {
        body: {
          event_id: prop.game_description,
          sport: prop.sport,
          player_name: prop.player_name,
          prop_type: prop.prop_type,
          bookmaker: prop.bookmaker
        }
      });

      if (error) throw error;
      return data;
    },
    onSuccess: (data, prop) => {
      if (data?.found && data?.odds) {
        toast({
          title: 'Odds Updated',
          description: `${prop.player_name}: Line ${data.odds.line}, Over ${data.odds.over_price}, Under ${data.odds.under_price}`,
        });
        queryClient.invalidateQueries({ queryKey: ['collab-tracked-props'] });
      } else {
        toast({
          title: 'Not Available',
          description: `${prop.player_name} prop not found on ${prop.bookmaker}`,
        });
      }
    },
    onError: () => {
      toast({
        title: 'Error',
        description: 'Failed to fetch current odds',
        variant: 'destructive',
      });
    },
  });

  // Analyze prop mutation
  const analyzeProp = useMutation({
    mutationFn: async (prop: TrackedProp) => {
      const { data, error } = await supabase.functions.invoke('analyze-sharp-line', {
        body: {
          player_name: prop.player_name,
          prop_type: prop.prop_type,
          sport: prop.sport,
          opening_line: prop.opening_line,
          opening_over_price: prop.opening_over_price,
          opening_under_price: prop.opening_under_price,
          current_line: prop.current_line || prop.opening_line,
          current_over_price: prop.current_over_price || prop.opening_over_price,
          current_under_price: prop.current_under_price || prop.opening_under_price,
        }
      });

      if (error) throw error;
      return data;
    },
    onSuccess: (data, prop) => {
      toast({
        title: 'Analysis Complete',
        description: `${prop.player_name}: ${data.recommendation || 'Analysis completed'}`,
      });
      queryClient.invalidateQueries({ queryKey: ['collab-tracked-props'] });
    },
    onError: () => {
      toast({
        title: 'Error',
        description: 'Failed to analyze prop',
        variant: 'destructive',
      });
    },
  });

  // Fetch all odds mutation
  const fetchAllOdds = useMutation({
    mutationFn: async () => {
      const props = trackedProps?.filter(p => p.status !== 'completed') || [];
      const results = [];
      
      for (const prop of props.slice(0, 10)) { // Limit to 10 at a time
        try {
          const { data } = await supabase.functions.invoke('fetch-current-odds', {
            body: {
              event_id: prop.game_description,
              sport: prop.sport,
              player_name: prop.player_name,
              prop_type: prop.prop_type,
              bookmaker: prop.bookmaker
            }
          });
          results.push({ prop, data });
        } catch (err) {
          console.error('Error fetching odds for', prop.player_name, err);
        }
      }
      
      return results;
    },
    onSuccess: (results) => {
      const found = results.filter(r => r.data?.found).length;
      toast({
        title: 'Bulk Fetch Complete',
        description: `Updated ${found} of ${results.length} props`,
      });
      queryClient.invalidateQueries({ queryKey: ['collab-tracked-props'] });
    },
    onError: () => {
      toast({
        title: 'Error',
        description: 'Failed to fetch odds',
        variant: 'destructive',
      });
    },
  });

  if (isCheckingRole) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!isCollaborator && !isAdmin) {
    return null;
  }

  const filteredProps = trackedProps?.filter(p => 
    p.player_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    p.prop_type.toLowerCase().includes(searchTerm.toLowerCase()) ||
    p.game_description.toLowerCase().includes(searchTerm.toLowerCase())
  ) || [];

  const getMovementBadge = (movement: number | null) => {
    if (!movement) return null;
    if (movement > 0) {
      return <Badge className="bg-red-500/20 text-red-400">+{movement}</Badge>;
    } else if (movement < 0) {
      return <Badge className="bg-green-500/20 text-green-400">{movement}</Badge>;
    }
    return <Badge variant="outline">0</Badge>;
  };

  const getConfidenceBadge = (confidence: number | null, direction: string | null) => {
    if (!confidence || !direction) return null;
    const color = direction === 'over' ? 'text-green-400' : direction === 'under' ? 'text-red-400' : 'text-muted-foreground';
    return (
      <Badge variant="outline" className={color}>
        {direction?.toUpperCase()} {Math.round(confidence * 100)}%
      </Badge>
    );
  };

  return (
    <div className="min-h-screen bg-background pb-24">
      {/* Header */}
      <div className="bg-card border-b border-border p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity className="w-6 h-6 text-primary" />
            <h1 className="font-display text-xl text-foreground">COLLABORATOR ACCESS</h1>
          </div>
          <Badge variant="outline" className="text-primary border-primary">
            {isAdmin ? 'Admin' : 'Collaborator'}
          </Badge>
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* Search and Actions */}
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search props..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9"
              />
            </div>
            <div className="flex gap-2">
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => refetch()}
                disabled={isLoading}
              >
                <RefreshCw className={`w-4 h-4 mr-1 ${isLoading ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => fetchAllOdds.mutate()}
                disabled={fetchAllOdds.isPending}
              >
                {fetchAllOdds.isPending ? (
                  <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                ) : (
                  <Zap className="w-4 h-4 mr-1" />
                )}
                Fetch All Odds
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-2">
          <Card>
            <CardContent className="p-3 text-center">
              <p className="text-2xl font-bold">{trackedProps?.length || 0}</p>
              <p className="text-xs text-muted-foreground">Total Props</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3 text-center">
              <p className="text-2xl font-bold text-green-500">
                {trackedProps?.filter(p => p.ai_direction === 'over').length || 0}
              </p>
              <p className="text-xs text-muted-foreground">Over Signals</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3 text-center">
              <p className="text-2xl font-bold text-red-500">
                {trackedProps?.filter(p => p.ai_direction === 'under').length || 0}
              </p>
              <p className="text-xs text-muted-foreground">Under Signals</p>
            </CardContent>
          </Card>
        </div>

        {/* Props List */}
        {isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          </div>
        ) : filteredProps.length > 0 ? (
          <div className="space-y-3">
            {filteredProps.map((prop) => (
              <Card key={prop.id} className="overflow-hidden">
                <CardContent className="p-4">
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <h3 className="font-medium">{prop.player_name}</h3>
                      <p className="text-xs text-muted-foreground">{prop.prop_type}</p>
                    </div>
                    <div className="flex gap-1">
                      {getMovementBadge(prop.line_movement)}
                      {getConfidenceBadge(prop.ai_confidence, prop.ai_direction)}
                    </div>
                  </div>

                  <p className="text-xs text-muted-foreground mb-3">{prop.game_description}</p>

                  <div className="grid grid-cols-2 gap-3 mb-3">
                    <div className="bg-muted/30 rounded-lg p-2">
                      <p className="text-xs text-muted-foreground mb-1">Opening</p>
                      <p className="text-sm font-medium">Line: {prop.opening_line}</p>
                      <div className="flex gap-2 text-xs">
                        <span className="text-green-400">O: {prop.opening_over_price}</span>
                        <span className="text-red-400">U: {prop.opening_under_price}</span>
                      </div>
                    </div>
                    <div className="bg-muted/30 rounded-lg p-2">
                      <p className="text-xs text-muted-foreground mb-1">Current</p>
                      <p className="text-sm font-medium">
                        Line: {prop.current_line ?? prop.opening_line}
                      </p>
                      <div className="flex gap-2 text-xs">
                        <span className="text-green-400">
                          O: {prop.current_over_price ?? prop.opening_over_price}
                        </span>
                        <span className="text-red-400">
                          U: {prop.current_under_price ?? prop.opening_under_price}
                        </span>
                      </div>
                    </div>
                  </div>

                  {prop.ai_recommendation && (
                    <div className="bg-primary/10 rounded-lg p-2 mb-3">
                      <p className="text-xs font-medium text-primary mb-1">AI Recommendation</p>
                      <p className="text-sm">{prop.ai_recommendation}</p>
                    </div>
                  )}

                  <div className="flex items-center justify-between text-xs text-muted-foreground mb-3">
                    <div className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {prop.last_updated 
                        ? formatDistanceToNow(new Date(prop.last_updated), { addSuffix: true })
                        : 'Not updated'
                      }
                    </div>
                    <Badge variant="outline" className="text-xs">
                      {prop.sport}
                    </Badge>
                  </div>

                  <div className="flex gap-2">
                    <Button 
                      size="sm" 
                      variant="outline"
                      onClick={() => fetchOdds.mutate(prop)}
                      disabled={fetchOdds.isPending}
                      className="flex-1"
                    >
                      {fetchOdds.isPending ? (
                        <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                      ) : (
                        <DollarSign className="w-3 h-3 mr-1" />
                      )}
                      Fetch Odds
                    </Button>
                    <Button 
                      size="sm" 
                      variant="outline"
                      onClick={() => analyzeProp.mutate(prop)}
                      disabled={analyzeProp.isPending}
                      className="flex-1"
                    >
                      {analyzeProp.isPending ? (
                        <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                      ) : (
                        <Target className="w-3 h-3 mr-1" />
                      )}
                      Analyze
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <Card>
            <CardContent className="p-8 text-center text-muted-foreground">
              <Activity className="w-12 h-12 mx-auto mb-2 opacity-50" />
              <p>No tracked props found</p>
              {searchTerm && <p className="text-xs mt-1">Try a different search term</p>}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
