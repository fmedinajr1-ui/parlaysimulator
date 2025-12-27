import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Search, User, Shield, Crown, BarChart3, Unlock, Users, ExternalLink } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { Database } from '@/integrations/supabase/types';

type AppRole = Database['public']['Enums']['app_role'];

interface UserProfile {
  id: string;
  email: string | null;
}

interface UserRole {
  id: string;
  user_id: string;
  role: AppRole;
}

interface FeatureConfig {
  role: AppRole;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
}

const FEATURE_CONFIGS: FeatureConfig[] = [
  {
    role: 'collaborator',
    label: 'Collaborator',
    description: 'Can edit odds & props on collaborate page',
    icon: Users,
    color: 'text-blue-500'
  },
  {
    role: 'elite_access',
    label: 'Elite Hitter',
    description: 'Access to Daily Elite 3-Leg Hitter',
    icon: Crown,
    color: 'text-yellow-500'
  },
  {
    role: 'odds_tracker_access',
    label: 'Odds Tracker',
    description: 'Access to Odds Tracker Pro features',
    icon: BarChart3,
    color: 'text-green-500'
  },
  {
    role: 'full_access',
    label: 'Full Access',
    description: 'Unlimited access to all features',
    icon: Unlock,
    color: 'text-purple-500'
  },
  {
    role: 'admin',
    label: 'Admin',
    description: 'Full administrative privileges',
    icon: Shield,
    color: 'text-red-500'
  }
];

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

  // Search users
  const { data: searchResults, isLoading: isSearching } = useQuery({
    queryKey: ['user-search', searchQuery],
    queryFn: async () => {
      if (!searchQuery || searchQuery.length < 2) return [];
      
      const { data, error } = await supabase
        .from('profiles')
        .select('id, email')
        .ilike('email', `%${searchQuery}%`)
        .limit(10);
      
      if (error) throw error;
      return data as UserProfile[];
    },
    enabled: searchQuery.length >= 2
  });

  // Fetch selected user's roles
  const { data: userRoles, isLoading: isLoadingRoles } = useQuery({
    queryKey: ['user-roles', selectedUser?.id],
    queryFn: async () => {
      if (!selectedUser) return [];
      
      const { data, error } = await supabase
        .from('user_roles')
        .select('id, user_id, role')
        .eq('user_id', selectedUser.id);
      
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
      queryClient.invalidateQueries({ queryKey: ['user-roles', selectedUser?.id] });
      queryClient.invalidateQueries({ queryKey: ['access-counts'] });
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

  const hasRole = (role: AppRole) => {
    return userRoles?.some(r => r.role === role) || false;
  };

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
                    <p className="text-xs text-muted-foreground">User ID: {selectedUser.id.slice(0, 8)}...</p>
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
                              userId: selectedUser.id,
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
