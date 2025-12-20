import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, Users, Copy, Share2, Lock, Clock, CheckCircle, Plus, Trophy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { SubmitLegModal } from '@/components/pools/SubmitLegModal';
import { shareContent, getShareableUrl } from '@/lib/utils';

interface Pool {
  id: string;
  invite_code: string;
  creator_id: string;
  pool_name: string;
  num_legs_required: number;
  status: string;
  combined_odds: number;
  stake_per_member: number;
  created_at: string;
  is_won: boolean | null;
}

interface PoolLeg {
  id: string;
  user_id: string;
  leg_index: number;
  description: string;
  odds: number;
  bet_type: string;
  sport: string;
  player_name: string;
  prop_type: string;
  line: number;
  side: string;
  status: string;
  engine_source: string;
  engine_confidence: number;
  submitted_at: string;
  profiles?: {
    username: string | null;
    avatar_url: string | null;
  } | null;
}

interface PoolMember {
  user_id: string;
  role: string;
  joined_at: string;
  profiles?: {
    username: string | null;
    avatar_url: string | null;
  } | null;
}

interface ProfileInfo {
  username: string | null;
  avatar_url: string | null;
}

export default function PoolDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [pool, setPool] = useState<Pool | null>(null);
  const [legs, setLegs] = useState<PoolLeg[]>([]);
  const [members, setMembers] = useState<PoolMember[]>([]);
  const [isMember, setIsMember] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitLegOpen, setSubmitLegOpen] = useState(false);
  const [username, setUsername] = useState<string | null>(null);

  // Fetch current user's username
  useEffect(() => {
    const fetchUsername = async () => {
      if (!user) return;
      const { data } = await supabase
        .from('profiles')
        .select('username')
        .eq('user_id', user.id)
        .single();
      if (data?.username) {
        setUsername(data.username);
      }
    };
    fetchUsername();
  }, [user]);

  const fetchPoolDetails = async () => {
    if (!id || !user) return;

    try {
      // Force refresh session to get valid token
      await supabase.auth.refreshSession();
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;

      if (!token) {
        toast.error('Please sign in again');
        setLoading(false);
        return;
      }

      const response = await supabase.functions.invoke('pool-manager', {
        body: { action: 'get-pool', pool_id: id },
        headers: { Authorization: `Bearer ${token}` }
      });

      if (response.error) {
        console.error('Function error:', response.error);
        toast.error('Failed to load pool');
        setLoading(false);
        return;
      }

      if (response.data?.pool) {
        setPool(response.data.pool);
        setLegs(response.data.legs || []);
        setMembers(response.data.members || []);
        setIsMember(response.data.is_member || false);
      } else {
        toast.error('Pool not found');
        navigate('/pools');
      }
    } catch (error) {
      console.error('Error fetching pool:', error);
      toast.error('Failed to load pool');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPoolDetails();
  }, [id, user]);

  // Realtime subscription
  useEffect(() => {
    if (!id) return;

    const channel = supabase
      .channel(`pool-${id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pool_legs', filter: `pool_id=eq.${id}` }, () => {
        fetchPoolDetails();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'parlay_pools', filter: `id=eq.${id}` }, () => {
        fetchPoolDetails();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [id]);

  const copyInviteLink = () => {
    if (!pool) return;
    const link = getShareableUrl(`/pools/join/${pool.invite_code}`);
    navigator.clipboard.writeText(link);
    toast.success('Invite link copied!');
  };

  const sharePool = async () => {
    if (!pool) return;
    const link = getShareableUrl(`/pools/join/${pool.invite_code}`);
    const shareText = username 
      ? `@${username} wants you to join their parlay pool: ${pool.pool_name}`
      : `Join my parlay pool: ${pool.pool_name}`;
    
    const shared = await shareContent({
      title: pool.pool_name,
      text: shareText,
      url: link
    });
    
    if (!shared) {
      toast.success('Invite link copied!');
    }
  };

  const formatOdds = (odds: number) => {
    if (!odds) return '-';
    return odds > 0 ? `+${odds}` : odds.toString();
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'open':
        return <Clock className="w-5 h-5 text-neon-green" />;
      case 'in_progress':
        return <Lock className="w-5 h-5 text-neon-yellow" />;
      case 'settled':
        return <CheckCircle className="w-5 h-5 text-primary" />;
      default:
        return null;
    }
  };

  const getLegStatusColor = (status: string) => {
    switch (status) {
      case 'won':
        return 'border-neon-green bg-neon-green/10';
      case 'lost':
        return 'border-destructive bg-destructive/10';
      case 'push':
        return 'border-neon-yellow bg-neon-yellow/10';
      default:
        return 'border-border';
    }
  };

  const hasUserSubmittedLeg = legs.some(leg => leg.user_id === user?.id);

  if (loading) {
    return (
      <div className="min-h-screen bg-background p-4">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-muted rounded w-1/3" />
          <div className="h-32 bg-muted rounded" />
          <div className="h-24 bg-muted rounded" />
        </div>
      </div>
    );
  }

  if (!pool) {
    return (
      <div className="min-h-screen bg-background p-4 flex items-center justify-center">
        <Card className="p-6 text-center">
          <h2 className="text-xl font-display mb-2">Pool Not Found</h2>
          <Button onClick={() => navigate('/pools')}>Back to Pools</Button>
        </Card>
      </div>
    );
  }

  const progress = (legs.length / pool.num_legs_required) * 100;

  return (
    <div className="min-h-screen bg-background pb-24">
      {/* Header */}
      <div className="bg-gradient-to-b from-primary/20 to-background p-4 pt-8">
        <div className="flex items-center gap-3 mb-4">
          <Button variant="ghost" size="icon" onClick={() => navigate('/pools')}>
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              {getStatusIcon(pool.status)}
              <h1 className="text-xl font-display">{pool.pool_name}</h1>
            </div>
            <p className="text-sm text-muted-foreground">
              {legs.length}/{pool.num_legs_required} legs • {members.length} members
            </p>
          </div>
          <Button variant="outline" size="icon" onClick={sharePool}>
            <Share2 className="w-4 h-4" />
          </Button>
        </div>

        {/* Progress */}
        <Card className="p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-muted-foreground">Pool Progress</span>
            <span className="text-sm font-medium">{legs.length}/{pool.num_legs_required}</span>
          </div>
          <Progress value={progress} className="h-2 mb-3" />
          
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <div className="text-2xl font-display text-neon-green">
                {formatOdds(pool.combined_odds)}
              </div>
              <div className="text-xs text-muted-foreground">Combined Odds</div>
            </div>
            <div>
              <div className="text-2xl font-display">${pool.stake_per_member}</div>
              <div className="text-xs text-muted-foreground">Stake</div>
            </div>
            <div>
              <div className="text-2xl font-display text-primary">
                ${(pool.stake_per_member * members.length * (pool.combined_odds > 0 ? (pool.combined_odds / 100 + 1) : (1 + 100 / Math.abs(pool.combined_odds || 100)))).toFixed(0)}
              </div>
              <div className="text-xs text-muted-foreground">Potential</div>
            </div>
          </div>
        </Card>
      </div>

      <div className="p-4 space-y-4">
        {/* Invite Link */}
        {pool.status === 'open' && (
          <Card className="p-4 border-primary/30 bg-primary/5">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-medium mb-1">Invite Friends</h3>
                <p className="text-sm text-muted-foreground">Share the link to grow your pool</p>
              </div>
              <Button onClick={copyInviteLink} variant="outline" size="sm">
                <Copy className="w-4 h-4 mr-2" />
                Copy Link
              </Button>
            </div>
          </Card>
        )}

        {/* Submit Leg CTA */}
        {pool.status === 'open' && isMember && !hasUserSubmittedLeg && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
          >
            <Card 
              className="p-4 border-neon-green/30 bg-neon-green/5 cursor-pointer hover:bg-neon-green/10 transition-colors"
              onClick={() => setSubmitLegOpen(true)}
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full gradient-neon flex items-center justify-center">
                  <Plus className="w-5 h-5 text-primary-foreground" />
                </div>
                <div>
                  <h3 className="font-medium">Submit Your Leg</h3>
                  <p className="text-sm text-muted-foreground">Add your pick to the pool</p>
                </div>
              </div>
            </Card>
          </motion.div>
        )}

        {/* Legs */}
        <div>
          <h2 className="font-display text-lg mb-3">Legs</h2>
          <div className="space-y-3">
            {legs.length === 0 ? (
              <Card className="p-6 text-center">
                <Trophy className="w-10 h-10 mx-auto mb-2 text-muted-foreground" />
                <p className="text-muted-foreground">No legs submitted yet</p>
              </Card>
            ) : (
              legs.map((leg, index) => (
                <motion.div
                  key={leg.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.05 }}
                >
                  <Card className={`p-4 border-2 ${getLegStatusColor(leg.status)}`}>
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-xs">
                          Leg {leg.leg_index}
                        </Badge>
                        {leg.engine_source && (
                          <Badge variant="secondary" className="text-xs">
                            {leg.engine_source}
                          </Badge>
                        )}
                      </div>
                      <span className="font-medium text-neon-green">
                        {formatOdds(leg.odds)}
                      </span>
                    </div>
                    <p className="font-medium mb-1">{leg.description}</p>
                    <div className="flex items-center gap-3 text-sm text-muted-foreground">
                      <span className="text-xs">
                        by {leg.profiles?.username || (leg.user_id === user?.id ? 'You' : 'Member')}
                      </span>
                      {leg.sport && <span>• {leg.sport}</span>}
                      {leg.bet_type && <span>• {leg.bet_type}</span>}
                      {leg.status !== 'pending' && (
                        <Badge 
                          variant="outline" 
                          className={`ml-auto ${
                            leg.status === 'won' ? 'text-neon-green border-neon-green' :
                            leg.status === 'lost' ? 'text-destructive border-destructive' :
                            'text-neon-yellow border-neon-yellow'
                          }`}
                        >
                          {leg.status.toUpperCase()}
                        </Badge>
                      )}
                    </div>
                  </Card>
                </motion.div>
              ))
            )}
          </div>
        </div>

        {/* Members */}
        <div>
          <h2 className="font-display text-lg mb-3">Members ({members.length})</h2>
          <Card className="p-4">
            <div className="flex flex-wrap gap-2">
              {members.map((member) => (
                <Badge 
                  key={member.user_id} 
                  variant={member.role === 'creator' ? 'default' : 'secondary'}
                  className="py-1"
                >
                  <Users className="w-3 h-3 mr-1" />
                  {member.user_id === user?.id 
                    ? 'You' 
                    : member.profiles?.username || (member.role === 'creator' ? 'Creator' : 'Member')}
                  {member.role === 'creator' && member.user_id !== user?.id && ' (Creator)'}
                </Badge>
              ))}
            </div>
          </Card>
        </div>
      </div>

      <SubmitLegModal
        open={submitLegOpen}
        onOpenChange={setSubmitLegOpen}
        poolId={pool.id}
        onLegSubmitted={fetchPoolDetails}
      />
    </div>
  );
}
