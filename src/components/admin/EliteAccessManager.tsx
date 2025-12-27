import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { Crown, Search, UserMinus, Loader2, Users, Zap, ShieldCheck } from 'lucide-react';

interface EliteUser {
  id: string;
  user_id: string;
  role: string;
  email?: string;
  username?: string;
}

interface SearchResultWithRoles {
  user_id: string;
  email: string;
  roles: string[];
}

const QUICK_ADD_ROLES = [
  { role: 'elite_access', label: '+Elite', icon: Crown, color: 'text-yellow-500' },
  { role: 'collaborator', label: '+Collab', icon: Users, color: 'text-blue-500' },
  { role: 'full_access', label: '+Full', icon: Zap, color: 'text-green-500' },
] as const;

const ROLE_BADGES: Record<string, { label: string; icon: typeof Crown; color: string }> = {
  elite_access: { label: 'Elite', icon: Crown, color: 'text-yellow-500 border-yellow-500/30' },
  collaborator: { label: 'Collab', icon: Users, color: 'text-blue-500 border-blue-500/30' },
  full_access: { label: 'Full', icon: Zap, color: 'text-green-500 border-green-500/30' },
  admin: { label: 'Admin', icon: ShieldCheck, color: 'text-red-500 border-red-500/30' },
};

export function EliteAccessManager() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [searchEmail, setSearchEmail] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [searchResult, setSearchResult] = useState<SearchResultWithRoles | null>(null);

  // Fetch users with elite_access role
  const { data: eliteUsers, isLoading } = useQuery({
    queryKey: ['elite-access-users'],
    queryFn: async () => {
      const { data: roles, error } = await supabase
        .from('user_roles')
        .select('id, user_id, role')
        .eq('role', 'elite_access');
      
      if (error) throw error;
      
      // Get profile info and all roles for each user
      const usersWithProfiles = await Promise.all(
        (roles || []).map(async (role) => {
          const [profileRes, rolesRes] = await Promise.all([
            supabase
              .from('profiles')
              .select('email, username')
              .eq('user_id', role.user_id)
              .maybeSingle(),
            supabase
              .from('user_roles')
              .select('role')
              .eq('user_id', role.user_id)
          ]);
          
          return {
            ...role,
            email: profileRes.data?.email || 'Unknown',
            username: profileRes.data?.username || null,
            allRoles: rolesRes.data?.map(r => r.role) || []
          };
        })
      );
      
      return usersWithProfiles as (EliteUser & { allRoles: string[] })[];
    }
  });

  // Search for user by email and fetch their roles
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
        // Fetch all roles for this user
        const { data: userRoles } = await supabase
          .from('user_roles')
          .select('role')
          .eq('user_id', data.user_id);
        
        setSearchResult({
          ...data,
          roles: userRoles?.map(r => r.role) || []
        });
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

  // Quick add any role
  const quickAddMutation = useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: string }) => {
      const { error } = await supabase
        .from('user_roles')
        .insert([{ user_id: userId, role: role as 'elite_access' | 'collaborator' | 'full_access' }]);
      if (error) {
        if (error.code === '23505') {
          throw new Error(`User already has ${role} access`);
        }
        throw error;
      }
    },
    onSuccess: (_, { role }) => {
      queryClient.invalidateQueries({ queryKey: ['elite-access-users'] });
      queryClient.invalidateQueries({ queryKey: ['all-users-with-roles'] });
      // Update local search result
      if (searchResult) {
        setSearchResult({
          ...searchResult,
          roles: [...searchResult.roles, role]
        });
      }
      toast({
        title: "Access granted",
        description: `Successfully added ${role.replace('_', ' ')} access`
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
      queryClient.invalidateQueries({ queryKey: ['all-users-with-roles'] });
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
          
          {/* Search Result with Multi-Role Quick Add */}
          {searchResult && (
            <div className="p-4 rounded-lg bg-muted/50 border border-border space-y-3">
              <div>
                <p className="font-medium text-sm">{searchResult.email}</p>
                {/* Current role badges */}
                {searchResult.roles.length > 0 ? (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {searchResult.roles.map((role) => {
                      const badge = ROLE_BADGES[role];
                      if (!badge) return null;
                      const Icon = badge.icon;
                      return (
                        <Badge key={role} variant="outline" className={badge.color}>
                          <Icon className="w-3 h-3 mr-1" />
                          {badge.label}
                        </Badge>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground mt-1">No roles assigned</p>
                )}
              </div>
              
              {/* Quick Add Buttons */}
              <div className="flex flex-wrap gap-2 pt-2 border-t border-border/50">
                {QUICK_ADD_ROLES.map(({ role, label, icon: Icon, color }) => {
                  const hasRole = searchResult.roles.includes(role);
                  return (
                    <Button
                      key={role}
                      size="sm"
                      variant={hasRole ? "secondary" : "outline"}
                      disabled={hasRole || quickAddMutation.isPending}
                      onClick={() => quickAddMutation.mutate({ userId: searchResult.user_id, role })}
                      className={hasRole ? 'opacity-50' : ''}
                    >
                      {quickAddMutation.isPending ? (
                        <Loader2 className="w-3 h-3 animate-spin mr-1" />
                      ) : (
                        <Icon className={`w-3 h-3 mr-1 ${color}`} />
                      )}
                      {hasRole ? '✓' : label}
                    </Button>
                  );
                })}
              </div>
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
                    <div className="flex flex-wrap gap-1 mt-1">
                      {user.allRoles?.map((role) => {
                        const badge = ROLE_BADGES[role];
                        if (!badge) return null;
                        const Icon = badge.icon;
                        return (
                          <Badge key={role} variant="outline" className={`text-xs ${badge.color}`}>
                            <Icon className="w-2.5 h-2.5 mr-0.5" />
                            {badge.label}
                          </Badge>
                        );
                      })}
                    </div>
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
