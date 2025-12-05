import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { 
  UserCheck, 
  UserX, 
  Plus, 
  Loader2, 
  Search,
  Trash2,
  Eye
} from 'lucide-react';

interface ApprovedUser {
  id: string;
  email: string;
  approved_at: string;
  approved_by: string | null;
  notes: string | null;
  is_active: boolean;
}

export function ApprovedUsersManager() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [users, setUsers] = useState<ApprovedUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newNotes, setNewNotes] = useState('');
  const [isAdding, setIsAdding] = useState(false);

  useEffect(() => {
    fetchApprovedUsers();
  }, []);

  const fetchApprovedUsers = async () => {
    try {
      const { data, error } = await supabase
        .from('approved_odds_users')
        .select('*')
        .order('approved_at', { ascending: false });

      if (error) throw error;
      setUsers(data || []);
    } catch (err) {
      console.error('Error fetching approved users:', err);
      toast({
        title: 'Error',
        description: 'Failed to load approved users',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddUser = async () => {
    if (!newEmail.trim() || !user) return;

    setIsAdding(true);
    try {
      const { error } = await supabase
        .from('approved_odds_users')
        .insert({
          email: newEmail.trim().toLowerCase(),
          approved_by: user.id,
          notes: newNotes.trim() || null,
        });

      if (error) {
        if (error.code === '23505') {
          toast({
            title: 'Already Exists',
            description: 'This email is already approved',
            variant: 'destructive',
          });
          return;
        }
        throw error;
      }

      toast({
        title: 'User Approved',
        description: `${newEmail} now has odds tracking access`,
      });

      setNewEmail('');
      setNewNotes('');
      fetchApprovedUsers();
    } catch (err) {
      console.error('Error adding user:', err);
      toast({
        title: 'Error',
        description: 'Failed to add user',
        variant: 'destructive',
      });
    } finally {
      setIsAdding(false);
    }
  };

  const handleToggleActive = async (id: string, currentState: boolean) => {
    try {
      const { error } = await supabase
        .from('approved_odds_users')
        .update({ is_active: !currentState })
        .eq('id', id);

      if (error) throw error;

      setUsers(users.map(u => 
        u.id === id ? { ...u, is_active: !currentState } : u
      ));

      toast({
        title: currentState ? 'Access Revoked' : 'Access Restored',
        description: `User access has been ${currentState ? 'revoked' : 'restored'}`,
      });
    } catch (err) {
      console.error('Error toggling user:', err);
      toast({
        title: 'Error',
        description: 'Failed to update user',
        variant: 'destructive',
      });
    }
  };

  const handleDeleteUser = async (id: string) => {
    try {
      const { error } = await supabase
        .from('approved_odds_users')
        .delete()
        .eq('id', id);

      if (error) throw error;

      setUsers(users.filter(u => u.id !== id));

      toast({
        title: 'User Removed',
        description: 'User has been removed from approved list',
      });
    } catch (err) {
      console.error('Error deleting user:', err);
      toast({
        title: 'Error',
        description: 'Failed to remove user',
        variant: 'destructive',
      });
    }
  };

  const filteredUsers = users.filter(u => 
    u.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
    u.notes?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const activeCount = users.filter(u => u.is_active).length;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-2 gap-3">
        <Card>
          <CardContent className="p-3 text-center">
            <div className="flex items-center justify-center gap-2">
              <UserCheck className="w-5 h-5 text-neon-green" />
              <span className="text-2xl font-bold">{activeCount}</span>
            </div>
            <p className="text-xs text-muted-foreground">Active Users</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 text-center">
            <div className="flex items-center justify-center gap-2">
              <Eye className="w-5 h-5 text-primary" />
              <span className="text-2xl font-bold">{users.length}</span>
            </div>
            <p className="text-xs text-muted-foreground">Total Approved</p>
          </CardContent>
        </Card>
      </div>

      {/* Add User Form */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Plus className="w-4 h-4" />
            Approve New User
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input
            placeholder="Email address"
            type="email"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
          />
          <Input
            placeholder="Notes (optional)"
            value={newNotes}
            onChange={(e) => setNewNotes(e.target.value)}
          />
          <Button 
            onClick={handleAddUser}
            disabled={!newEmail.trim() || isAdding}
            className="w-full"
          >
            {isAdding ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <>
                <UserCheck className="w-4 h-4 mr-2" />
                Approve User
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Search users..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* User List */}
      <div className="space-y-2">
        {filteredUsers.length === 0 ? (
          <Card>
            <CardContent className="p-6 text-center text-muted-foreground">
              {searchQuery ? 'No users found' : 'No approved users yet'}
            </CardContent>
          </Card>
        ) : (
          filteredUsers.map((approvedUser) => (
            <Card 
              key={approvedUser.id}
              className={!approvedUser.is_active ? 'opacity-60' : ''}
            >
              <CardContent className="p-3">
                <div className="flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium truncate">
                        {approvedUser.email}
                      </p>
                      <Badge variant={approvedUser.is_active ? 'default' : 'secondary'}>
                        {approvedUser.is_active ? 'Active' : 'Inactive'}
                      </Badge>
                    </div>
                    {approvedUser.notes && (
                      <p className="text-xs text-muted-foreground mt-1 truncate">
                        {approvedUser.notes}
                      </p>
                    )}
                    <p className="text-[10px] text-muted-foreground mt-1">
                      Added {new Date(approvedUser.approved_at).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={approvedUser.is_active}
                      onCheckedChange={() => handleToggleActive(approvedUser.id, approvedUser.is_active)}
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleDeleteUser(approvedUser.id)}
                      className="h-8 w-8 text-destructive hover:text-destructive"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
