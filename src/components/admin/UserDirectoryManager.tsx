import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { 
  Users, 
  Mail, 
  Phone, 
  Search, 
  CheckCircle, 
  XCircle, 
  Loader2,
  RefreshCw,
  Download
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';

interface UserData {
  user_id: string;
  email: string | null;
  username: string | null;
  avatar_url: string | null;
  phone_number: string | null;
  phone_verified: boolean;
  email_verified: boolean;
  total_wins: number;
  total_losses: number;
  total_staked: number;
  lifetime_degenerate_score: number;
  created_at: string;
}

type FilterType = 'all' | 'email_verified' | 'email_unverified' | 'phone_verified' | 'phone_unverified' | 'both_verified';

export function UserDirectoryManager() {
  const [users, setUsers] = useState<UserData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState<FilterType>('all');
  const { toast } = useToast();

  const fetchUsers = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase.rpc('get_all_users_admin');
      
      if (error) throw error;
      
      setUsers((data || []) as UserData[]);
    } catch (err) {
      console.error('Error fetching users:', err);
      toast({
        title: "Error",
        description: "Failed to load user directory",
        variant: "destructive"
      });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const filteredUsers = useMemo(() => {
    let result = users;

    // Apply search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(user => 
        user.email?.toLowerCase().includes(query) ||
        user.username?.toLowerCase().includes(query) ||
        user.phone_number?.includes(query)
      );
    }

    // Apply status filter
    switch (filter) {
      case 'email_verified':
        result = result.filter(u => u.email_verified);
        break;
      case 'email_unverified':
        result = result.filter(u => !u.email_verified);
        break;
      case 'phone_verified':
        result = result.filter(u => u.phone_verified);
        break;
      case 'phone_unverified':
        result = result.filter(u => !u.phone_verified);
        break;
      case 'both_verified':
        result = result.filter(u => u.email_verified && u.phone_verified);
        break;
    }

    return result;
  }, [users, searchQuery, filter]);

  // Stats calculations
  const stats = useMemo(() => ({
    total: users.length,
    emailVerified: users.filter(u => u.email_verified).length,
    phoneVerified: users.filter(u => u.phone_verified).length,
    bothVerified: users.filter(u => u.email_verified && u.phone_verified).length,
  }), [users]);

  const maskPhoneNumber = (phone: string | null) => {
    if (!phone) return '—';
    if (phone.length <= 4) return phone;
    return `•••-•••-${phone.slice(-4)}`;
  };

  const exportToCSV = () => {
    const headers = ['Email', 'Username', 'Phone', 'Email Verified', 'Phone Verified', 'Joined'];
    const rows = filteredUsers.map(user => [
      user.email || '',
      user.username || '',
      user.phone_number || '',
      user.email_verified ? 'Yes' : 'No',
      user.phone_verified ? 'Yes' : 'No',
      user.created_at ? format(new Date(user.created_at), 'yyyy-MM-dd') : ''
    ]);

    const csvContent = [headers, ...rows]
      .map(row => row.map(cell => `"${cell}"`).join(','))
      .join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `users-export-${format(new Date(), 'yyyy-MM-dd')}.csv`;
    a.click();
    URL.revokeObjectURL(url);

    toast({
      title: "Export Complete",
      description: `Exported ${filteredUsers.length} users to CSV`
    });
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <Users className="w-5 h-5 text-primary" />
            </div>
            <div>
              <CardTitle className="text-lg">User Directory</CardTitle>
              <CardDescription>All users with verification status</CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button 
              variant="outline" 
              size="sm"
              onClick={exportToCSV}
              disabled={filteredUsers.length === 0}
            >
              <Download className="w-4 h-4 mr-1" />
              Export
            </Button>
            <Button 
              variant="outline" 
              size="sm"
              onClick={fetchUsers}
              disabled={isLoading}
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card className="bg-muted/30">
            <CardContent className="p-3 text-center">
              <div className="flex items-center justify-center gap-2 mb-1">
                <Users className="w-4 h-4 text-muted-foreground" />
              </div>
              <p className="text-2xl font-bold text-foreground">{stats.total}</p>
              <p className="text-xs text-muted-foreground">Total Users</p>
            </CardContent>
          </Card>
          <Card className="bg-muted/30">
            <CardContent className="p-3 text-center">
              <div className="flex items-center justify-center gap-2 mb-1">
                <Mail className="w-4 h-4 text-blue-500" />
              </div>
              <p className="text-2xl font-bold text-blue-500">{stats.emailVerified}</p>
              <p className="text-xs text-muted-foreground">Email Verified</p>
            </CardContent>
          </Card>
          <Card className="bg-muted/30">
            <CardContent className="p-3 text-center">
              <div className="flex items-center justify-center gap-2 mb-1">
                <Phone className="w-4 h-4 text-green-500" />
              </div>
              <p className="text-2xl font-bold text-green-500">{stats.phoneVerified}</p>
              <p className="text-xs text-muted-foreground">Phone Verified</p>
            </CardContent>
          </Card>
          <Card className="bg-muted/30">
            <CardContent className="p-3 text-center">
              <div className="flex items-center justify-center gap-2 mb-1">
                <CheckCircle className="w-4 h-4 text-emerald-500" />
              </div>
              <p className="text-2xl font-bold text-emerald-500">{stats.bothVerified}</p>
              <p className="text-xs text-muted-foreground">Fully Verified</p>
            </CardContent>
          </Card>
        </div>

        {/* Search & Filter */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search by email, username, or phone..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={filter} onValueChange={(v) => setFilter(v as FilterType)}>
            <SelectTrigger className="w-full sm:w-48">
              <SelectValue placeholder="Filter by status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Users</SelectItem>
              <SelectItem value="email_verified">Email Verified</SelectItem>
              <SelectItem value="email_unverified">Email Not Verified</SelectItem>
              <SelectItem value="phone_verified">Phone Verified</SelectItem>
              <SelectItem value="phone_unverified">Phone Not Verified</SelectItem>
              <SelectItem value="both_verified">Fully Verified</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* User Table */}
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
          </div>
        ) : filteredUsers.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <Users className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p>No users found</p>
          </div>
        ) : (
          <ScrollArea className="h-[400px]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Username</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead className="text-center">Email</TableHead>
                  <TableHead className="text-center">Phone</TableHead>
                  <TableHead>Joined</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredUsers.map((user) => (
                  <TableRow key={user.user_id}>
                    <TableCell className="font-mono text-sm">
                      {user.email || <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell>
                      {user.username || <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="font-mono text-sm text-muted-foreground">
                      {maskPhoneNumber(user.phone_number)}
                    </TableCell>
                    <TableCell className="text-center">
                      {user.email_verified ? (
                        <Badge variant="outline" className="bg-blue-500/10 text-blue-500 border-blue-500/30">
                          <CheckCircle className="w-3 h-3 mr-1" />
                          ✓
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="bg-muted text-muted-foreground">
                          <XCircle className="w-3 h-3 mr-1" />
                          ✗
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      {user.phone_verified ? (
                        <Badge variant="outline" className="bg-green-500/10 text-green-500 border-green-500/30">
                          <CheckCircle className="w-3 h-3 mr-1" />
                          ✓
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="bg-muted text-muted-foreground">
                          <XCircle className="w-3 h-3 mr-1" />
                          ✗
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {user.created_at ? format(new Date(user.created_at), 'MMM d, yyyy') : '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollArea>
        )}

        {/* Footer */}
        <div className="text-sm text-muted-foreground text-center pt-2 border-t border-border">
          Showing {filteredUsers.length} of {users.length} users
        </div>
      </CardContent>
    </Card>
  );
}
