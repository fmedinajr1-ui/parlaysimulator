import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Users, Plus, Trophy, ChevronRight, Lock, Clock, CheckCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { CreatePoolModal } from '@/components/pools/CreatePoolModal';
import { PoolLeaderboard } from '@/components/pools/PoolLeaderboard';

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
  member_count?: number;
  legs_submitted?: number;
  creator_username?: string | null;
  creator_avatar?: string | null;
}

export default function Pools() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [myPools, setMyPools] = useState<Pool[]>([]);
  const [openPools, setOpenPools] = useState<Pool[]>([]);
  const [loading, setLoading] = useState(true);
  const [createModalOpen, setCreateModalOpen] = useState(false);

  const fetchPools = async () => {
    if (!user) return;

    try {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;

      // Fetch user's pools
      const myPoolsResponse = await supabase.functions.invoke('pool-manager', {
        body: { action: 'list-pools', user_only: true },
        headers: { Authorization: `Bearer ${token}` }
      });

      if (myPoolsResponse.data?.pools) {
        setMyPools(myPoolsResponse.data.pools);
      }

      // Fetch open pools
      const openPoolsResponse = await supabase.functions.invoke('pool-manager', {
        body: { action: 'list-pools', status: 'open' },
        headers: { Authorization: `Bearer ${token}` }
      });

      if (openPoolsResponse.data?.pools) {
        setOpenPools(openPoolsResponse.data.pools.filter(
          (p: Pool) => !myPoolsResponse.data?.pools?.some((mp: Pool) => mp.id === p.id)
        ));
      }
    } catch (error) {
      console.error('Error fetching pools:', error);
      toast.error('Failed to load pools');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPools();
  }, [user]);

  // Realtime subscription for pool updates
  useEffect(() => {
    if (!user) return;

    const channel = supabase
      .channel('pools-realtime')
      .on('postgres_changes', { 
        event: '*', 
        schema: 'public', 
        table: 'parlay_pools' 
      }, (payload) => {
        console.log('Pool changed:', payload);
        fetchPools();
      })
      .on('postgres_changes', { 
        event: '*', 
        schema: 'public', 
        table: 'pool_legs' 
      }, () => {
        fetchPools();
      })
      .on('postgres_changes', { 
        event: 'INSERT', 
        schema: 'public', 
        table: 'pool_memberships' 
      }, () => {
        fetchPools();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);

  const handlePoolCreated = () => {
    fetchPools();
    setCreateModalOpen(false);
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'open':
        return <Clock className="w-4 h-4 text-neon-green" />;
      case 'in_progress':
        return <Lock className="w-4 h-4 text-neon-yellow" />;
      case 'settled':
        return <CheckCircle className="w-4 h-4 text-primary" />;
      default:
        return null;
    }
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, string> = {
      open: 'bg-neon-green/20 text-neon-green border-neon-green/30',
      in_progress: 'bg-neon-yellow/20 text-neon-yellow border-neon-yellow/30',
      settled: 'bg-primary/20 text-primary border-primary/30',
      cancelled: 'bg-destructive/20 text-destructive border-destructive/30'
    };

    return (
      <Badge variant="outline" className={`${variants[status] || ''} uppercase text-xs`}>
        {status.replace('_', ' ')}
      </Badge>
    );
  };

  const formatOdds = (odds: number) => {
    if (!odds) return '-';
    return odds > 0 ? `+${odds}` : odds.toString();
  };

  if (!user) {
    return (
      <div className="min-h-screen bg-background p-4 flex items-center justify-center">
        <Card className="p-6 text-center">
          <Users className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
          <h2 className="text-xl font-display mb-2">Sign In Required</h2>
          <p className="text-muted-foreground mb-4">Join or create parlay pools with friends</p>
          <Button onClick={() => navigate('/auth')}>Sign In</Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-24">
      {/* Header */}
      <div className="bg-gradient-to-b from-primary/20 to-background p-4 pt-8">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-display text-foreground">Parlay Pools</h1>
            <p className="text-sm text-muted-foreground">Build parlays with friends</p>
          </div>
          <Button 
            onClick={() => setCreateModalOpen(true)}
            className="gradient-neon text-primary-foreground"
          >
            <Plus className="w-4 h-4 mr-2" />
            Create Pool
          </Button>
        </div>
      </div>

      <div className="p-4">
        <Tabs defaultValue="my-pools" className="w-full">
          <TabsList className="grid w-full grid-cols-3 mb-4">
            <TabsTrigger value="my-pools">My Pools</TabsTrigger>
            <TabsTrigger value="browse">Browse</TabsTrigger>
            <TabsTrigger value="leaderboard">Leaderboard</TabsTrigger>
          </TabsList>

          <TabsContent value="my-pools" className="space-y-3">
            {loading ? (
              <div className="space-y-3">
                {[1, 2, 3].map(i => (
                  <Card key={i} className="p-4 animate-pulse">
                    <div className="h-6 bg-muted rounded w-1/3 mb-2" />
                    <div className="h-4 bg-muted rounded w-1/2" />
                  </Card>
                ))}
              </div>
            ) : myPools.length === 0 ? (
              <Card className="p-8 text-center">
                <Users className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
                <h3 className="font-display text-lg mb-2">No Pools Yet</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Create your first pool or join one from a friend's link
                </p>
                <Button onClick={() => setCreateModalOpen(true)}>
                  <Plus className="w-4 h-4 mr-2" />
                  Create Your First Pool
                </Button>
              </Card>
            ) : (
              myPools.map((pool, index) => (
                <motion.div
                  key={pool.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.05 }}
                >
                  <Card 
                    className="p-4 cursor-pointer hover:bg-muted/50 transition-colors"
                    onClick={() => navigate(`/pools/${pool.id}`)}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          {getStatusIcon(pool.status)}
                          <h3 className="font-medium">{pool.pool_name}</h3>
                          {getStatusBadge(pool.status)}
                        </div>
                        <div className="flex items-center gap-4 text-sm text-muted-foreground">
                          <span>{pool.legs_submitted || 0}/{pool.num_legs_required} legs</span>
                          <span>{pool.member_count || 0} members</span>
                          {pool.combined_odds > 0 && (
                            <span className="text-neon-green font-medium">
                              {formatOdds(pool.combined_odds)}
                            </span>
                          )}
                        </div>
                      </div>
                      <ChevronRight className="w-5 h-5 text-muted-foreground" />
                    </div>
                  </Card>
                </motion.div>
              ))
            )}
          </TabsContent>

          <TabsContent value="browse" className="space-y-3">
            {loading ? (
              <div className="space-y-3">
                {[1, 2, 3].map(i => (
                  <Card key={i} className="p-4 animate-pulse">
                    <div className="h-6 bg-muted rounded w-1/3 mb-2" />
                    <div className="h-4 bg-muted rounded w-1/2" />
                  </Card>
                ))}
              </div>
            ) : openPools.length === 0 ? (
              <Card className="p-8 text-center">
                <Trophy className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
                <h3 className="font-display text-lg mb-2">No Open Pools</h3>
                <p className="text-sm text-muted-foreground">
                  All pools are either full or already joined
                </p>
              </Card>
            ) : (
              openPools.map((pool, index) => (
                <motion.div
                  key={pool.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.05 }}
                >
                  <Card 
                    className="p-4 cursor-pointer hover:bg-muted/50 transition-colors"
                    onClick={() => navigate(`/pools/join/${pool.invite_code}`)}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <Users className="w-4 h-4 text-primary" />
                          <h3 className="font-medium">{pool.pool_name}</h3>
                          {getStatusBadge(pool.status)}
                        </div>
                        <div className="flex items-center gap-4 text-sm text-muted-foreground">
                          <span>{pool.legs_submitted || 0}/{pool.num_legs_required} legs</span>
                          <span>{pool.member_count || 0} members</span>
                          <span>${pool.stake_per_member} stake</span>
                          {pool.creator_username && (
                            <span className="text-xs">by {pool.creator_username}</span>
                          )}
                        </div>
                      </div>
                      <Button size="sm" variant="outline">
                        Join
                      </Button>
                    </div>
                  </Card>
                </motion.div>
              ))
            )}
          </TabsContent>

          <TabsContent value="leaderboard">
            <PoolLeaderboard />
          </TabsContent>
        </Tabs>
      </div>

      <CreatePoolModal 
        open={createModalOpen} 
        onOpenChange={setCreateModalOpen}
        onPoolCreated={handlePoolCreated}
      />
    </div>
  );
}
