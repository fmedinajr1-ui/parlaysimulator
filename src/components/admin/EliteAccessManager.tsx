import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { Crown, Search, UserPlus, UserMinus, Loader2, CheckCircle } from 'lucide-react';

interface EliteUser {
  id: string;
  user_id: string;
  role: string;
  email?: string;
  username?: string;
}

export function EliteAccessManager() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [searchEmail, setSearchEmail] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [searchResult, setSearchResult] = useState<{ user_id: string; email: string } | null>(null);

  // Fetch users with elite_access role
  const { data: eliteUsers, isLoading } = useQuery({
    queryKey: ['elite-access-users'],
    queryFn: async () => {
      const { data: roles, error } = await supabase
        .from('user_roles')
        .select('id, user_id, role')
        .eq('role', 'elite_access');
      
      if (error) throw error;
      
      // Get profile info for each user
      const usersWithProfiles = await Promise.all(
        (roles || []).map(async (role) => {
          const { data: profile } = await supabase
            .from('profiles')
            .select('email, username')
            .eq('user_id', role.user_id)
            .maybeSingle();
          
          return {
            ...role,
            email: profile?.email || 'Unknown',
            username: profile?.username || null
          };
        })
      );
      
      return usersWithProfiles as EliteUser[];
    }
  });

  // Search for user by email
  const handleSearch = async () => {
    if (!searchEmail.trim()) return;
    
    setIsSearching(true);
    setSearchResult(null);
    
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('user_id, email')
        .ilike('email', `%${searchEmail}%`)
        .limit(1)
        .maybeSingle();
      
      if (error) throw error;
      
      if (data) {
        setSearchResult(data);
      } else {
        toast({
          title: "User not found",
          description: "No user found with that email",
          variant: "destructive"
        });
      }
    } catch (err) {
      console.error('Search error:', err);
      toast({
        title: "Search failed",
        description: "Could not search for user",
        variant: "destructive"
      });
    } finally {
      setIsSearching(false);
    }
  };

  // Grant elite access
  const grantAccessMutation = useMutation({
    mutationFn: async (userId: string) => {
      const { error } = await supabase
        .from('user_roles')
        .insert({ user_id: userId, role: 'elite_access' });
      
      if (error) {
        if (error.code === '23505') {
          throw new Error('User already has elite access');
        }
        throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['elite-access-users'] });
      setSearchResult(null);
      setSearchEmail('');
      toast({
        title: "Access granted",
        description: "User now has elite access to Daily Hitter"
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to grant access",
        description: error.message,
        variant: "destructive"
      });
    }
  });

  // Revoke elite access
  const revokeAccessMutation = useMutation({
    mutationFn: async (userId: string) => {
      const { error } = await supabase
        .from('user_roles')
        .delete()
        .eq('user_id', userId)
        .eq('role', 'elite_access');
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['elite-access-users'] });
      toast({
        title: "Access revoked",
        description: "User no longer has elite access"
      });
    },
    onError: () => {
      toast({
        title: "Failed to revoke access",
        description: "Could not remove elite access",
        variant: "destructive"
      });
    }
  });

  const hasEliteAccess = (userId: string) => {
    return eliteUsers?.some(u => u.user_id === userId);
  };

  return (
    <Card className="border-primary/30">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Crown className="w-5 h-5 text-primary" />
          Elite Access Manager
        </CardTitle>
        <CardDescription>
          Grant or revoke access to the Daily Elite 3-Leg Hitter
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Search and Grant Access */}
        <div className="space-y-3">
          <label className="text-sm font-medium">Add User by Email</label>
          <div className="flex gap-2">
            <Input
              placeholder="Search user email..."
              value={searchEmail}
              onChange={(e) => setSearchEmail(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            />
            <Button onClick={handleSearch} disabled={isSearching}>
              {isSearching ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Search className="w-4 h-4" />
              )}
            </Button>
          </div>
          
          {/* Search Result */}
          {searchResult && (
            <div className="p-3 rounded-lg bg-muted/50 border border-border flex items-center justify-between">
              <div>
                <p className="font-medium text-sm">{searchResult.email}</p>
                {hasEliteAccess(searchResult.user_id) ? (
                  <Badge variant="outline" className="text-green-500 border-green-500/30 mt-1">
                    <CheckCircle className="w-3 h-3 mr-1" />
                    Has Access
                  </Badge>
                ) : (
                  <p className="text-xs text-muted-foreground">No elite access</p>
                )}
              </div>
              {!hasEliteAccess(searchResult.user_id) && (
                <Button
                  size="sm"
                  onClick={() => grantAccessMutation.mutate(searchResult.user_id)}
                  disabled={grantAccessMutation.isPending}
                >
                  {grantAccessMutation.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <>
                      <UserPlus className="w-4 h-4 mr-1" />
                      Grant
                    </>
                  )}
                </Button>
              )}
            </div>
          )}
        </div>

        {/* Current Elite Users */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium">Users with Elite Access</label>
            <Badge variant="secondary">{eliteUsers?.length || 0} users</Badge>
          </div>
          
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : eliteUsers && eliteUsers.length > 0 ? (
            <div className="space-y-2">
              {eliteUsers.map((user) => (
                <div
                  key={user.id}
                  className="p-3 rounded-lg bg-muted/30 border border-border/50 flex items-center justify-between"
                >
                  <div>
                    <p className="font-medium text-sm">{user.email}</p>
                    {user.username && (
                      <p className="text-xs text-muted-foreground">@{user.username}</p>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-red-500 hover:text-red-600 hover:bg-red-500/10"
                    onClick={() => revokeAccessMutation.mutate(user.user_id)}
                    disabled={revokeAccessMutation.isPending}
                  >
                    {revokeAccessMutation.isPending ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <>
                        <UserMinus className="w-4 h-4 mr-1" />
                        Revoke
                      </>
                    )}
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-4">
              No users with elite access yet
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
