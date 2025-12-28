import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { 
  UserPlus, 
  Trash2, 
  Loader2, 
  Users, 
  Mail,
  Calendar,
  AlertCircle
} from 'lucide-react';
import { format } from 'date-fns';

interface Collaborator {
  id: string;
  user_id: string;
  role: string;
  created_at: string;
  email?: string;
}

export function CollaboratorManager() {
  const [email, setEmail] = useState('');
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch collaborators
  const { data: collaborators, isLoading } = useQuery({
    queryKey: ['collaborators'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('user_roles')
        .select('*')
        .eq('role', 'collaborator')
        .order('created_at', { ascending: false });

      if (error) throw error;

      // Get emails for each collaborator
      const collaboratorsWithEmails: Collaborator[] = [];
      for (const collab of data || []) {
        // Try to get email from profiles or use user_id as fallback
        const { data: profileData } = await supabase
          .from('profiles')
          .select('username')
          .eq('user_id', collab.user_id)
          .single();
        
        collaboratorsWithEmails.push({
          ...collab,
          email: profileData?.username || collab.user_id.substring(0, 8) + '...'
        });
      }

      return collaboratorsWithEmails;
    },
  });

  // Add collaborator mutation
  const addCollaborator = useMutation({
    mutationFn: async (userEmail: string) => {
      // First, find user by email in auth.users via a lookup
      // Since we can't query auth.users directly, we'll look for the user in profiles
      // or create the role entry if the user signs up later
      
      // Try to find user by email using admin function or profile lookup
      const { data: existingProfile, error: profileError } = await supabase
        .from('profiles')
        .select('user_id, username')
        .ilike('username', userEmail)
        .maybeSingle();

      if (profileError && profileError.code !== 'PGRST116') {
        throw new Error('Error looking up user');
      }

      let userId: string;

      if (existingProfile) {
        userId = existingProfile.user_id;
      } else {
        // For now, we'll store the email as placeholder and inform the admin
        // They need to ensure the user signs up with this email first
        throw new Error('User not found. The user must create an account first with this email/username.');
      }

      // Check if already a collaborator
      const { data: existingRole } = await supabase
        .from('user_roles')
        .select('id')
        .eq('user_id', userId)
        .eq('role', 'collaborator')
        .maybeSingle();

      if (existingRole) {
        throw new Error('User is already a collaborator');
      }

      // Add collaborator role
      const { error: insertError } = await supabase
        .from('user_roles')
        .insert({
          user_id: userId,
          role: 'collaborator'
        });

      if (insertError) throw insertError;

      return { userId, email: userEmail };
    },
    onSuccess: () => {
      toast({
        title: 'Collaborator Added',
        description: 'User has been granted collaborator access',
      });
      setEmail('');
      queryClient.invalidateQueries({ queryKey: ['collaborators'] });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  // Remove collaborator mutation
  const removeCollaborator = useMutation({
    mutationFn: async (collaboratorId: string) => {
      const { error } = await supabase
        .from('user_roles')
        .delete()
        .eq('id', collaboratorId);

      if (error) throw error;
    },
    onSuccess: () => {
      toast({
        title: 'Collaborator Removed',
        description: 'User access has been revoked',
      });
      queryClient.invalidateQueries({ queryKey: ['collaborators'] });
    },
    onError: () => {
      toast({
        title: 'Error',
        description: 'Failed to remove collaborator',
        variant: 'destructive',
      });
    },
  });

  const handleAddCollaborator = (e: React.FormEvent) => {
    e.preventDefault();
    if (email.trim()) {
      addCollaborator.mutate(email.trim());
    }
  };

  return (
    <div className="space-y-4">
      {/* Add Collaborator Form */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <UserPlus className="w-5 h-5 text-primary" />
            Add Collaborator
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleAddCollaborator} className="flex gap-2">
            <div className="flex-1 relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Enter username or email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="pl-9"
              />
            </div>
            <Button 
              type="submit" 
              disabled={!email.trim() || addCollaborator.isPending}
            >
              {addCollaborator.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                'Add'
              )}
            </Button>
          </form>
          <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1">
            <AlertCircle className="w-3 h-3" />
            User must have an account with this username first
          </p>
        </CardContent>
      </Card>

      {/* Collaborator List */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Users className="w-5 h-5 text-primary" />
            Active Collaborators
            {collaborators && collaborators.length > 0 && (
              <Badge variant="secondary" className="ml-2">
                {collaborators.length}
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : collaborators && collaborators.length > 0 ? (
            <div className="space-y-2">
              {collaborators.map((collab) => (
                <div 
                  key={collab.id}
                  className="flex items-center justify-between p-3 rounded-lg bg-muted/50 border border-border/50"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center">
                      <Users className="w-4 h-4 text-primary" />
                    </div>
                    <div>
                      <p className="text-sm font-medium">{collab.email}</p>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Calendar className="w-3 h-3" />
                        Added {format(new Date(collab.created_at), 'MMM d, yyyy')}
                      </div>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => removeCollaborator.mutate(collab.id)}
                    disabled={removeCollaborator.isPending}
                    className="text-destructive hover:text-destructive hover:bg-destructive/10"
                  >
                    {removeCollaborator.isPending ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Trash2 className="w-4 h-4" />
                    )}
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <Users className="w-12 h-12 mx-auto mb-2 opacity-50" />
              <p>No collaborators yet</p>
              <p className="text-xs mt-1">Add users by their username above</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Info Card */}
      <Card className="bg-primary/5 border-primary/20">
        <CardContent className="p-4">
          <h4 className="font-medium mb-2">Collaborator Access</h4>
          <ul className="text-sm text-muted-foreground space-y-1">
            <li>• View all tracked props</li>
            <li>• Fetch current odds for any prop</li>
            <li>• Run AI analysis on props</li>
            <li>• Update manual odds entries</li>
          </ul>
          <p className="text-xs mt-3 text-muted-foreground/70">
            Collaborators access features at /collaborate
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
