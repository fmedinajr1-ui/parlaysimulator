import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { Search, UserPlus, Trash2, Users, ShieldCheck, Key, Star } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

type AuthorizedUser = {
  id: string;
  chat_id: string;
  username: string | null;
  authorized_by: string;
  is_active: boolean;
  authorized_at: string;
};

const AUTH_BADGE_MAP: Record<string, { label: string; className: string; icon: React.ReactNode }> = {
  grandfathered: { label: 'OG', className: 'bg-green-500/20 text-green-400 border-green-500/30', icon: <Star className="w-3 h-3" /> },
  password: { label: 'Password', className: 'bg-blue-500/20 text-blue-400 border-blue-500/30', icon: <Key className="w-3 h-3" /> },
  admin_grant: { label: 'Admin', className: 'bg-purple-500/20 text-purple-400 border-purple-500/30', icon: <ShieldCheck className="w-3 h-3" /> },
};

export function TelegramCustomerManager() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [newChatId, setNewChatId] = useState('');

  const { data: users = [], isLoading } = useQuery({
    queryKey: ['bot-authorized-users'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bot_authorized_users')
        .select('*')
        .order('authorized_at', { ascending: false });
      if (error) throw error;
      return data as AuthorizedUser[];
    },
  });

  const toggleActive = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase
        .from('bot_authorized_users')
        .update({ is_active })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bot-authorized-users'] });
      toast({ title: 'Status updated' });
    },
    onError: (e) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  const deleteUser = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('bot_authorized_users')
        .delete()
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bot-authorized-users'] });
      toast({ title: 'User removed' });
    },
    onError: (e) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  const grantAccess = useMutation({
    mutationFn: async (chat_id: string) => {
      const { error } = await supabase
        .from('bot_authorized_users')
        .insert({ chat_id, authorized_by: 'admin_grant', is_active: true });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bot-authorized-users'] });
      setNewChatId('');
      toast({ title: 'Access granted' });
    },
    onError: (e) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  const filtered = users.filter((u) => {
    const q = search.toLowerCase();
    return !q || (u.username?.toLowerCase().includes(q)) || u.chat_id.includes(q);
  });

  const activeCount = users.filter((u) => u.is_active).length;
  const byMethod = users.reduce<Record<string, number>>((acc, u) => {
    acc[u.authorized_by] = (acc[u.authorized_by] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-3 gap-2">
        <Card>
          <CardContent className="p-3 text-center">
            <p className="text-2xl font-bold">{users.length}</p>
            <p className="text-xs text-muted-foreground">Total</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 text-center">
            <p className="text-2xl font-bold text-green-400">{activeCount}</p>
            <p className="text-xs text-muted-foreground">Active</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 text-center">
            <p className="text-2xl font-bold text-red-400">{users.length - activeCount}</p>
            <p className="text-xs text-muted-foreground">Inactive</p>
          </CardContent>
        </Card>
      </div>

      {/* Auth method breakdown */}
      <div className="flex gap-2 flex-wrap">
        {Object.entries(byMethod).map(([method, count]) => {
          const badge = AUTH_BADGE_MAP[method] || { label: method, className: 'bg-muted text-muted-foreground', icon: null };
          return (
            <Badge key={method} variant="outline" className={badge.className}>
              {badge.icon} <span className="ml-1">{badge.label}: {count}</span>
            </Badge>
          );
        })}
      </div>

      {/* Grant access */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2"><UserPlus className="w-4 h-4" /> Grant Access</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (newChatId.trim()) grantAccess.mutate(newChatId.trim());
            }}
          >
            <Input
              placeholder="Telegram Chat ID"
              value={newChatId}
              onChange={(e) => setNewChatId(e.target.value)}
              className="h-10"
            />
            <Button type="submit" size="sm" className="h-10" disabled={!newChatId.trim() || grantAccess.isPending}>
              Add
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Search + List */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2"><Users className="w-4 h-4" /> Customers</CardTitle>
            <Badge variant="outline">{filtered.length}</Badge>
          </div>
          <div className="relative mt-2">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search username or chat ID..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 h-9"
            />
          </div>
        </CardHeader>
        <CardContent className="space-y-1 max-h-[400px] overflow-y-auto">
          {isLoading ? (
            <p className="text-sm text-muted-foreground text-center py-4">Loading...</p>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">No customers found</p>
          ) : (
            filtered.map((user) => {
              const badge = AUTH_BADGE_MAP[user.authorized_by] || { label: user.authorized_by, className: '', icon: null };
              return (
                <div
                  key={user.id}
                  className="flex items-center justify-between gap-2 p-2 rounded-lg border border-border/50 bg-card/50"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm truncate">
                        {user.username ? `@${user.username}` : user.chat_id}
                      </span>
                      <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${badge.className}`}>
                        {badge.icon}{badge.label}
                      </Badge>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      {user.username ? `ID: ${user.chat_id} · ` : ''}
                      {formatDistanceToNow(new Date(user.authorized_at), { addSuffix: true })}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Switch
                      checked={user.is_active}
                      onCheckedChange={(checked) => toggleActive.mutate({ id: user.id, is_active: checked })}
                    />
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive">
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Remove user?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This will permanently remove {user.username ? `@${user.username}` : user.chat_id} from the authorized users list.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={() => deleteUser.mutate(user.id)}>Remove</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>
    </div>
  );
}
