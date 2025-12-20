import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Users, Trophy, ArrowRight, CheckCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

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
}

export default function JoinPool() {
  const { inviteCode } = useParams<{ inviteCode: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [pool, setPool] = useState<Pool | null>(null);
  const [memberCount, setMemberCount] = useState(0);
  const [legCount, setLegCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [isMember, setIsMember] = useState(false);

  useEffect(() => {
    const fetchPool = async () => {
      if (!inviteCode) {
        navigate('/pools');
        return;
      }

      try {
        // Fetch pool by invite code (public read)
        const { data: poolData, error } = await supabase
          .from('parlay_pools')
          .select('*')
          .eq('invite_code', inviteCode)
          .single();

        if (error || !poolData) {
          toast.error('Pool not found');
          navigate('/pools');
          return;
        }

        setPool(poolData);

        // Get member count
        const { count: members } = await supabase
          .from('pool_memberships')
          .select('*', { count: 'exact', head: true })
          .eq('pool_id', poolData.id);

        setMemberCount(members || 0);

        // Get leg count
        const { count: legs } = await supabase
          .from('pool_legs')
          .select('*', { count: 'exact', head: true })
          .eq('pool_id', poolData.id);

        setLegCount(legs || 0);

        // Check if user is already a member
        if (user) {
          const { data: membership } = await supabase
            .from('pool_memberships')
            .select('id')
            .eq('pool_id', poolData.id)
            .eq('user_id', user.id)
            .single();

          setIsMember(!!membership);
        }
      } catch (error) {
        console.error('Error fetching pool:', error);
        toast.error('Failed to load pool');
      } finally {
        setLoading(false);
      }
    };

    fetchPool();
  }, [inviteCode, user, navigate]);

  const handleJoin = async () => {
    if (!user) {
      // Redirect to auth with return URL
      navigate(`/auth?redirect=/pools/join/${inviteCode}`);
      return;
    }

    if (!pool) return;

    setJoining(true);

    try {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;

      const response = await supabase.functions.invoke('pool-manager', {
        body: { action: 'join', invite_code: inviteCode },
        headers: { Authorization: `Bearer ${token}` }
      });

      if (response.data?.error) {
        toast.error(response.data.error);
        return;
      }

      if (response.data?.already_member) {
        toast.info('You are already a member of this pool');
      } else {
        toast.success('Successfully joined the pool!');
      }

      navigate(`/pools/${pool.id}`);
    } catch (error) {
      console.error('Error joining pool:', error);
      toast.error('Failed to join pool');
    } finally {
      setJoining(false);
    }
  };

  const formatOdds = (odds: number) => {
    if (!odds) return '-';
    return odds > 0 ? `+${odds}` : odds.toString();
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md p-6 animate-pulse">
          <div className="h-8 bg-muted rounded w-2/3 mx-auto mb-4" />
          <div className="h-32 bg-muted rounded mb-4" />
          <div className="h-12 bg-muted rounded" />
        </Card>
      </div>
    );
  }

  if (!pool) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md p-8 text-center">
          <Trophy className="w-16 h-16 mx-auto mb-4 text-muted-foreground" />
          <h1 className="text-2xl font-display mb-2">Pool Not Found</h1>
          <p className="text-muted-foreground mb-6">
            This invite link may be invalid or expired.
          </p>
          <Button onClick={() => navigate('/pools')}>Browse Pools</Button>
        </Card>
      </div>
    );
  }

  const progress = (legCount / pool.num_legs_required) * 100;
  const isFull = memberCount >= pool.num_legs_required;
  const isClosed = pool.status !== 'open';

  return (
    <div className="min-h-screen bg-gradient-to-b from-primary/10 to-background flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md"
      >
        <Card className="p-6 border-primary/30">
          {/* Header */}
          <div className="text-center mb-6">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full gradient-neon flex items-center justify-center">
              <Users className="w-8 h-8 text-primary-foreground" />
            </div>
            <h1 className="text-2xl font-display mb-1">{pool.pool_name}</h1>
            <p className="text-muted-foreground">You've been invited to join this parlay pool</p>
          </div>

          {/* Pool Stats */}
          <div className="bg-muted/50 rounded-xl p-4 mb-6">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm text-muted-foreground">Pool Progress</span>
              <Badge variant={pool.status === 'open' ? 'default' : 'secondary'}>
                {pool.status.replace('_', ' ').toUpperCase()}
              </Badge>
            </div>
            <Progress value={progress} className="h-2 mb-4" />
            
            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <div className="text-xl font-display">{legCount}/{pool.num_legs_required}</div>
                <div className="text-xs text-muted-foreground">Legs</div>
              </div>
              <div>
                <div className="text-xl font-display">{memberCount}</div>
                <div className="text-xs text-muted-foreground">Members</div>
              </div>
              <div>
                <div className="text-xl font-display text-neon-green">
                  {formatOdds(pool.combined_odds)}
                </div>
                <div className="text-xs text-muted-foreground">Odds</div>
              </div>
            </div>
          </div>

          {/* Pool Details */}
          <div className="space-y-3 mb-6">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Stake per member</span>
              <span className="font-medium">${pool.stake_per_member}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Legs required</span>
              <span className="font-medium">{pool.num_legs_required}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Spots remaining</span>
              <span className="font-medium">{Math.max(0, pool.num_legs_required - memberCount)}</span>
            </div>
          </div>

          {/* Action Button */}
          {isMember ? (
            <Button 
              className="w-full" 
              onClick={() => navigate(`/pools/${pool.id}`)}
            >
              <CheckCircle className="w-4 h-4 mr-2" />
              View Pool
            </Button>
          ) : isClosed ? (
            <Button className="w-full" disabled>
              Pool is Closed
            </Button>
          ) : isFull ? (
            <Button className="w-full" disabled>
              Pool is Full
            </Button>
          ) : (
            <Button 
              className="w-full gradient-neon text-primary-foreground" 
              onClick={handleJoin}
              disabled={joining}
            >
              {joining ? (
                'Joining...'
              ) : (
                <>
                  {user ? 'Join Pool' : 'Sign In to Join'}
                  <ArrowRight className="w-4 h-4 ml-2" />
                </>
              )}
            </Button>
          )}

          {/* Back link */}
          <Button 
            variant="ghost" 
            className="w-full mt-3"
            onClick={() => navigate('/pools')}
          >
            Browse Other Pools
          </Button>
        </Card>
      </motion.div>
    </div>
  );
}
