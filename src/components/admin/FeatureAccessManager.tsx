import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Search, User, Shield, Crown, BarChart3, Unlock, Users, ExternalLink, Plus, Check, RefreshCw, ChevronRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { Database } from '@/integrations/supabase/types';
import { ScrollArea } from '@/components/ui/scroll-area';

type AppRole = Database['public']['Enums']['app_role'];

interface UserProfile {
  id: string;
  user_id: string;
  email: string | null;
  username: string | null;
}

interface UserRole {
  id: string;
  user_id: string;
  role: AppRole;
}

interface UserWithRoles extends UserProfile {
  roles: AppRole[];
}

interface FeatureConfig {
  role: AppRole;
  label: string;
  shortLabel: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  bgColor: string;
}

const FEATURE_CONFIGS: FeatureConfig[] = [
  {
    role: 'collaborator',
    label: 'Collaborator',
    shortLabel: 'Collab',
    description: 'Can edit odds & props on collaborate page',
    icon: Users,
    color: 'text-blue-500',
    bgColor: 'bg-blue-500/10'
  },
  {
    role: 'elite_access',
    label: 'Elite Hitter',
    shortLabel: 'Elite',
    description: 'Access to Daily Elite 3-Leg Hitter',
    icon: Crown,
    color: 'text-yellow-500',
    bgColor: 'bg-yellow-500/10'
  },
  {
    role: 'odds_tracker_access',
    label: 'Odds Tracker',
    shortLabel: 'Odds',
    description: 'Access to Odds Tracker Pro features',
    icon: BarChart3,
    color: 'text-green-500',
    bgColor: 'bg-green-500/10'
  },
  {
    role: 'full_access',
    label: 'Full Access',
    shortLabel: 'Full',
    description: 'Unlimited access to all features',
    icon: Unlock,
    color: 'text-purple-500',
    bgColor: 'bg-purple-500/10'
  },
  {
    role: 'admin',
    label: 'Admin',
    shortLabel: 'Admin',
    description: 'Full administrative privileges',
    icon: Shield,
    color: 'text-red-500',
    bgColor: 'bg-red-500/10'
  }
];

// Quick add buttons - exclude admin for safety
const QUICK_ADD_ROLES: AppRole[] = ['collaborator', 'elite_access', 'full_access'];

export function FeatureAccessManager() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedUser, setSelectedUser] = useState<UserProfile | null>(null);

  // Fetch access counts
  const { data: accessCounts } = useQuery({
    queryKey: ['access-counts'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('user_roles')
        .select('role');
      
      if (error) throw error;
      
      const counts: Record<string, number> = {};
      (data || []).forEach(r => {
        counts[r.role] = (counts[r.role] || 0) + 1;
      });
      return counts;
    }
  });

  // Fetch all users with their roles
  const { data: allUsers, isLoading: isLoadingAllUsers, refetch: refetchAllUsers } = useQuery({
    queryKey: ['all-users-with-roles'],
    queryFn: async () => {
      // Fetch all profiles
      const { data: profiles, error: profilesError } = await supabase
        .from('profiles')
        .select('id, user_id, email, username')
        .order('email', { ascending: true });
      
      if (profilesError) throw profilesError;
      
      // Fetch all roles
      const { data: roles, error: rolesError } = await supabase
        .from('user_roles')
        .select('user_id, role');
      
      if (rolesError) throw rolesError;
      
      // Map roles to users
      const rolesByUser: Record<string, AppRole[]> = {};
      (roles || []).forEach(r => {
        if (!rolesByUser[r.user_id]) rolesByUser[r.user_id] = [];
        rolesByUser[r.user_id].push(r.role);
      });
      
      // Combine profiles with roles
      const usersWithRoles: UserWithRoles[] = (profiles || []).map(p => ({
        ...p,
        roles: rolesByUser[p.user_id] || []
      }));
      
      return usersWithRoles;
    }
  });

  // Search users
  const { data: searchResults, isLoading: isSearching } = useQuery({
    queryKey: ['user-search', searchQuery],
    queryFn: async () => {
      if (!searchQuery || searchQuery.length < 2) return [];
      
      const { data, error } = await supabase
        .from('profiles')
        .select('id, user_id, email, username')
        .ilike('email', `%${searchQuery}%`)
        .limit(10);
      
      if (error) throw error;
      return data as UserProfile[];
    },
    enabled: searchQuery.length >= 2
  });

  // Fetch selected user's roles
  const { data: userRoles, isLoading: isLoadingRoles } = useQuery({
    queryKey: ['user-roles', selectedUser?.user_id],
    queryFn: async () => {
      if (!selectedUser) return [];
      
      const { data, error } = await supabase
        .from('user_roles')
        .select('id, user_id, role')
        .eq('user_id', selectedUser.user_id);
      
      if (error) throw error;
      return data as UserRole[];
    },
    enabled: !!selectedUser
  });

  // Toggle role mutation
  const toggleRoleMutation = useMutation({
    mutationFn: async ({ userId, role, hasRole }: { userId: string; role: AppRole; hasRole: boolean }) => {
      if (hasRole) {
        // Remove role
        const { error } = await supabase
          .from('user_roles')
          .delete()
          .eq('user_id', userId)
          .eq('role', role);
        if (error) throw error;
      } else {
        // Add role
        const { error } = await supabase
          .from('user_roles')
          .insert({ user_id: userId, role });
        if (error) throw error;
      }
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['user-roles', selectedUser?.user_id] });
      queryClient.invalidateQueries({ queryKey: ['access-counts'] });
      queryClient.invalidateQueries({ queryKey: ['all-users-with-roles'] });
      toast({
        title: variables.hasRole ? 'Role Removed' : 'Role Added',
        description: `Successfully ${variables.hasRole ? 'removed' : 'added'} ${variables.role} role`
      });
    },
    onError: (error) => {
      toast({
        title: 'Error',
        description: 'Failed to update role',
        variant: 'destructive'
      });
      console.error('Role toggle error:', error);
    }
  });

  // Quick add role mutation (for all users list)
  const quickAddMutation = useMutation({
    mutationFn: async ({ userId, role, email }: { userId: string; role: AppRole; email: string }) => {
      const { error } = await supabase
        .from('user_roles')
        .insert({ user_id: userId, role });
      if (error) throw error;
      return { email, role };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['access-counts'] });
      queryClient.invalidateQueries({ queryKey: ['all-users-with-roles'] });
      toast({
        title: 'Role Added',
        description: `Added ${data.role} to ${data.email}`
      });
    },
    onError: (error) => {
      toast({
        title: 'Error',
        description: 'Failed to add role',
        variant: 'destructive'
      });
      console.error('Quick add error:', error);
    }
  });

  const hasRole = (role: AppRole) => {
    return userRoles?.some(r => r.role === role) || false;
  };

  const getFeatureConfig = (role: AppRole) => FEATURE_CONFIGS.find(c => c.role === role);

  return (
    <div className="space-y-6">
      {/* Access Overview Card */}
      <Card className="bg-gradient-to-br from-primary/5 to-primary/10 border-primary/20">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="w-5 h-5 text-primary" />
            Feature Access Overview
          </CardTitle>
          <CardDescription>Current user counts by access level</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
            {FEATURE_CONFIGS.map((config) => (
              <div key={config.role} className="text-center p-3 bg-background/50 rounded-lg">
                <config.icon className={`w-5 h-5 mx-auto mb-1 ${config.color}`} />
                <p className="text-2xl font-bold">{accessCounts?.[config.role] || 0}</p>
                <p className="text-xs text-muted-foreground">{config.label}</p>
              </div>
            ))}
          </div>
          <Button 
            variant="outline" 
            size="sm" 
            className="gap-2"
            onClick={() => navigate('/collaborate')}
          >
            <ExternalLink className="w-4 h-4" />
            Go to Collaborate Page
          </Button>
        </CardContent>
      </Card>

      {/* All Users List */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Users className="w-5 h-5" />
                All Users ({allUsers?.length || 0})
              </CardTitle>
              <CardDescription>Browse and quickly assign roles to users</CardDescription>
            </div>
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={() => refetchAllUsers()}
              disabled={isLoadingAllUsers}
            >
              <RefreshCw className={`w-4 h-4 ${isLoadingAllUsers ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isLoadingAllUsers ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <ScrollArea className="h-[300px] pr-4">
              <div className="space-y-2">
                {allUsers?.map((user) => (
                  <div
                    key={user.id}
                    className="flex items-center justify-between p-3 bg-muted/20 rounded-lg hover:bg-muted/30 transition-colors"
                  >
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <User className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{user.email || 'No email'}</p>
                        {user.username && (
                          <p className="text-xs text-muted-foreground">@{user.username}</p>
                        )}
                      </div>
                      {/* Role Badges */}
                      <div className="flex gap-1 flex-wrap">
                        {user.roles.map(role => {
                          const config = getFeatureConfig(role);
                          if (!config) return null;
                          return (
                            <Badge 
                              key={role} 
                              variant="secondary" 
                              className={`text-xs ${config.bgColor} ${config.color} border-0`}
                            >
                              {config.shortLabel}
                            </Badge>
                          );
                        })}
                      </div>
                    </div>
                    
                    {/* Quick Add Buttons */}
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {QUICK_ADD_ROLES.map(role => {
                        const config = getFeatureConfig(role);
                        const hasThisRole = user.roles.includes(role);
                        if (!config) return null;
                        
                        return (
                          <Button
                            key={role}
                            variant={hasThisRole ? "secondary" : "outline"}
                            size="sm"
                            className={`h-7 px-2 text-xs ${hasThisRole ? config.bgColor : ''}`}
                            disabled={hasThisRole || quickAddMutation.isPending}
                            onClick={() => quickAddMutation.mutate({ 
                              userId: user.user_id, 
                              role, 
                              email: user.email || 'user' 
                            })}
                          >
                            {hasThisRole ? (
                              <Check className={`w-3 h-3 ${config.color}`} />
                            ) : (
                              <>
                                <Plus className="w-3 h-3 mr-1" />
                                {config.shortLabel}
                              </>
                            )}
                          </Button>
                        );
                      })}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2"
                        onClick={() => setSelectedUser(user)}
                      >
                        <ChevronRight className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      {/* Feature Access Manager */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="w-5 h-5" />
            Feature Access Manager
          </CardTitle>
          <CardDescription>Search for a user and toggle their feature access</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Search Input */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search by email..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setSelectedUser(null);
              }}
              className="pl-10"
            />
          </div>

          {/* Search Results */}
          {isSearching && (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          )}

          {searchResults && searchResults.length > 0 && !selectedUser && (
            <div className="space-y-2">
              {searchResults.map((user) => (
                <div
                  key={user.id}
                  className="flex items-center justify-between p-3 bg-muted/30 rounded-lg hover:bg-muted/50 cursor-pointer transition-colors"
                  onClick={() => setSelectedUser(user)}
                >
                  <div className="flex items-center gap-3">
                    <User className="w-5 h-5 text-muted-foreground" />
                    <span className="text-sm">{user.email || 'No email'}</span>
                  </div>
                  <Badge variant="outline">Select</Badge>
                </div>
              ))}
            </div>
          )}

          {searchQuery.length >= 2 && searchResults?.length === 0 && !isSearching && (
            <p className="text-sm text-muted-foreground text-center py-4">
              No users found matching "{searchQuery}"
            </p>
          )}

          {/* Selected User Access Controls */}
          {selectedUser && (
            <div className="border rounded-lg p-4 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                    <User className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <p className="font-medium">{selectedUser.email}</p>
                    <p className="text-xs text-muted-foreground">User ID: {selectedUser.user_id.slice(0, 8)}...</p>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSelectedUser(null);
                    setSearchQuery('');
                  }}
                >
                  Clear
                </Button>
              </div>

              {isLoadingRoles ? (
                <div className="flex items-center justify-center py-4">
                  <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <div className="space-y-3">
                  <h4 className="text-sm font-medium text-muted-foreground">Feature Access</h4>
                  {FEATURE_CONFIGS.map((config) => {
                    const userHasRole = hasRole(config.role);
                    return (
                      <div
                        key={config.role}
                        className="flex items-center justify-between p-3 bg-muted/20 rounded-lg"
                      >
                        <div className="flex items-center gap-3">
                          <config.icon className={`w-5 h-5 ${config.color}`} />
                          <div>
                            <p className="font-medium text-sm">{config.label}</p>
                            <p className="text-xs text-muted-foreground">{config.description}</p>
                          </div>
                        </div>
                        <Switch
                          checked={userHasRole}
                          disabled={toggleRoleMutation.isPending}
                          onCheckedChange={() => {
                            toggleRoleMutation.mutate({
                              userId: selectedUser.user_id,
                              role: config.role,
                              hasRole: userHasRole
                            });
                          }}
                        />
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
