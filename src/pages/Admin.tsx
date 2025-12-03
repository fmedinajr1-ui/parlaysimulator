import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useAdminRole } from '@/hooks/useAdminRole';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/hooks/use-toast';
import { 
  FileText, 
  Mail, 
  Loader2, 
  Shield,
  CheckCircle,
  XCircle,
  RefreshCw,
  Download,
  Brain,
  Upload,
  Zap,
  TrendingUp,
  Calculator
} from 'lucide-react';
import { BottomNav } from '@/components/BottomNav';
import { AILearningDashboard } from '@/components/admin/AILearningDashboard';
import { BulkSlipUpload } from '@/components/admin/BulkSlipUpload';
import { SharpMoneyPanel } from '@/components/admin/SharpMoneyPanel';
import { LineShoppingPanel } from '@/components/admin/LineShoppingPanel';
import SharpLineCalculator from '@/components/admin/SharpLineCalculator';

interface ParlayData {
  id: string;
  user_id: string;
  username: string | null;
  legs: Array<{ description: string; odds: number }>;
  stake: number;
  potential_payout: number;
  combined_probability: number;
  degenerate_level: string;
  is_settled: boolean;
  is_won: boolean | null;
  created_at: string;
  event_start_time: string | null;
}

interface EmailSubscriber {
  id: string;
  email: string;
  subscribed_at: string;
  is_subscribed: boolean;
  source: string;
}

export default function Admin() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { isAdmin, isLoading: isCheckingAdmin } = useAdminRole();
  const { toast } = useToast();
  
  const [parlays, setParlays] = useState<ParlayData[]>([]);
  const [emails, setEmails] = useState<EmailSubscriber[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSettling, setIsSettling] = useState(false);
  const [activeTab, setActiveTab] = useState('ai-learning');
  const [selectedParlays, setSelectedParlays] = useState<Set<string>>(new Set());
  const [isBatchSettling, setIsBatchSettling] = useState(false);

  useEffect(() => {
    if (!isCheckingAdmin && !isAdmin) {
      toast({
        title: "Access Denied",
        description: "You don't have admin privileges",
        variant: "destructive"
      });
      navigate('/');
    }
  }, [isAdmin, isCheckingAdmin, navigate, toast]);

  useEffect(() => {
    if (isAdmin && !isCheckingAdmin) {
      fetchAdminData();
    }
  }, [isAdmin, isCheckingAdmin]);

  const fetchAdminData = async () => {
    setIsLoading(true);
    try {
      // Fetch parlays - handle independently
      let typedParlays: ParlayData[] = [];
      try {
        const { data: parlaysData, error: parlaysError } = await supabase.rpc('get_all_parlays_admin');
        if (parlaysError) {
          console.error('Error fetching parlays:', parlaysError);
        } else {
          typedParlays = (parlaysData || []).map((p: Record<string, unknown>) => ({
            ...p,
            legs: p.legs as Array<{ description: string; odds: number }>
          })) as ParlayData[];
        }
      } catch (parlayErr) {
        console.error('Exception fetching parlays:', parlayErr);
      }
      setParlays(typedParlays);

      // Fetch email subscribers - handle independently
      let emailsData: EmailSubscriber[] = [];
      try {
        const { data, error: emailsError } = await supabase
          .from('email_subscribers')
          .select('*')
          .order('subscribed_at', { ascending: false });
        if (emailsError) {
          console.error('Error fetching emails:', emailsError);
        } else {
          emailsData = data || [];
        }
      } catch (emailErr) {
        console.error('Exception fetching emails:', emailErr);
      }
      setEmails(emailsData);

    } catch (err) {
      console.error('Error fetching admin data:', err);
      toast({
        title: "Error",
        description: "Failed to load admin data",
        variant: "destructive"
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleManualSettle = async (parlayId: string, won: boolean) => {
    try {
      const { error } = await supabase
        .from('parlay_history')
        .update({
          is_settled: true,
          is_won: won,
          settled_at: new Date().toISOString()
        })
        .eq('id', parlayId);

      if (error) throw error;

      toast({
        title: "Parlay Settled",
        description: `Parlay marked as ${won ? 'won' : 'lost'}`
      });

      fetchAdminData();
    } catch (err) {
      console.error('Error settling parlay:', err);
      toast({
        title: "Error",
        description: "Failed to settle parlay",
        variant: "destructive"
      });
    }
  };

  const handleRunAutoSettle = async () => {
    setIsSettling(true);
    try {
      const { data, error } = await supabase.functions.invoke('auto-settle-parlays');
      
      if (error) throw error;

      toast({
        title: "Auto-Settle Complete",
        description: `Processed ${data.processed} parlays`
      });

      fetchAdminData();
    } catch (err) {
      console.error('Error running auto-settle:', err);
      toast({
        title: "Error",
        description: "Failed to run auto-settle",
        variant: "destructive"
      });
    } finally {
      setIsSettling(false);
    }
  };

  const exportEmails = () => {
    const subscribedEmails = emails.filter(e => e.is_subscribed).map(e => e.email);
    const csv = subscribedEmails.join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'email-subscribers.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  // Batch selection handlers
  const pendingParlaysList = parlays.filter(p => !p.is_settled);
  
  const handleSelectAll = () => {
    const pendingIds = pendingParlaysList.map(p => p.id);
    if (selectedParlays.size === pendingIds.length && pendingIds.length > 0) {
      setSelectedParlays(new Set());
    } else {
      setSelectedParlays(new Set(pendingIds));
    }
  };

  const handleToggleParlay = (id: string) => {
    const newSelected = new Set(selectedParlays);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedParlays(newSelected);
  };

  const handleBatchSettle = async (won: boolean) => {
    if (selectedParlays.size === 0) return;
    
    setIsBatchSettling(true);
    try {
      const ids = Array.from(selectedParlays);
      
      const { error } = await supabase
        .from('parlay_history')
        .update({
          is_settled: true,
          is_won: won,
          settled_at: new Date().toISOString()
        })
        .in('id', ids);

      if (error) throw error;

      toast({
        title: "Batch Settlement Complete",
        description: `${ids.length} parlay${ids.length > 1 ? 's' : ''} marked as ${won ? 'won' : 'lost'}`
      });

      setSelectedParlays(new Set());
      fetchAdminData();
    } catch (err) {
      console.error('Error batch settling:', err);
      toast({
        title: "Error",
        description: "Failed to settle parlays",
        variant: "destructive"
      });
    } finally {
      setIsBatchSettling(false);
    }
  };

  if (isCheckingAdmin || isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!isAdmin) {
    return null;
  }

  const totalParlays = parlays.length;
  const settledParlays = parlays.filter(p => p.is_settled).length;
  const pendingParlays = parlays.filter(p => !p.is_settled).length;

  return (
    <div className="min-h-screen bg-background pb-24">
      {/* Header */}
      <div className="bg-card border-b border-border p-4">
        <div className="flex items-center gap-2">
          <Shield className="w-6 h-6 text-primary" />
          <h1 className="font-display text-xl text-foreground">ADMIN PANEL</h1>
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-7">
            <TabsTrigger value="ai-learning" className="text-xs">
              <Brain className="w-3 h-3 mr-1" />
              AI
            </TabsTrigger>
            <TabsTrigger value="sharp-money" className="text-xs">
              <Zap className="w-3 h-3 mr-1" />
              Sharp
            </TabsTrigger>
            <TabsTrigger value="sharp-calc" className="text-xs">
              <Calculator className="w-3 h-3 mr-1" />
              Calc
            </TabsTrigger>
            <TabsTrigger value="line-shopping" className="text-xs">
              <TrendingUp className="w-3 h-3 mr-1" />
              Lines
            </TabsTrigger>
            <TabsTrigger value="bulk-upload" className="text-xs">
              <Upload className="w-3 h-3 mr-1" />
              Upload
            </TabsTrigger>
            <TabsTrigger value="parlays" className="text-xs">
              <FileText className="w-3 h-3 mr-1" />
              Parlays
            </TabsTrigger>
            <TabsTrigger value="emails" className="text-xs">
              <Mail className="w-3 h-3 mr-1" />
              Emails
            </TabsTrigger>
          </TabsList>

          {/* AI Learning Tab */}
          <TabsContent value="ai-learning" className="mt-4">
            <AILearningDashboard />
          </TabsContent>

          {/* Sharp Money Tab */}
          <TabsContent value="sharp-money" className="mt-4">
            <SharpMoneyPanel />
          </TabsContent>

          {/* Sharp Line Calculator Tab */}
          <TabsContent value="sharp-calc" className="mt-4">
            <SharpLineCalculator />
          </TabsContent>

          {/* Line Shopping Tab */}
          <TabsContent value="line-shopping" className="mt-4">
            <LineShoppingPanel />
          </TabsContent>

          {/* Bulk Upload Tab */}
          <TabsContent value="bulk-upload" className="mt-4">
            <BulkSlipUpload />
          </TabsContent>

          {/* Parlays Tab */}
          <TabsContent value="parlays" className="space-y-4 mt-4">
            {/* Stats */}
            <div className="grid grid-cols-3 gap-2">
              <Card>
                <CardContent className="p-3 text-center">
                  <p className="text-2xl font-bold">{totalParlays}</p>
                  <p className="text-xs text-muted-foreground">Total</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-3 text-center">
                  <p className="text-2xl font-bold text-green-500">{settledParlays}</p>
                  <p className="text-xs text-muted-foreground">Settled</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-3 text-center">
                  <p className="text-2xl font-bold text-yellow-500">{pendingParlays}</p>
                  <p className="text-xs text-muted-foreground">Pending</p>
                </CardContent>
              </Card>
            </div>

            {/* Auto-Settle Button */}
            <Button 
              onClick={handleRunAutoSettle} 
              disabled={isSettling}
              className="w-full"
            >
              {isSettling ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Running Auto-Settle...
                </>
              ) : (
                <>
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Run Auto-Settle
                </>
              )}
            </Button>

            {/* Batch Selection Controls */}
            {pendingParlays > 0 && (
              <Card className="bg-muted/50">
                <CardContent className="p-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Checkbox 
                        checked={selectedParlays.size === pendingParlaysList.length && pendingParlaysList.length > 0}
                        onCheckedChange={handleSelectAll}
                      />
                      <span className="text-sm">Select All Pending ({pendingParlays})</span>
                    </div>
                    {selectedParlays.size > 0 && (
                      <Button 
                        variant="ghost" 
                        size="sm"
                        onClick={() => setSelectedParlays(new Set())}
                      >
                        Clear
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Batch Action Bar */}
            {selectedParlays.size > 0 && (
              <Card className="sticky top-0 z-10 border-primary/50 shadow-lg">
                <CardContent className="p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium">
                      {selectedParlays.size} selected
                    </span>
                    <div className="flex gap-2">
                      <Button 
                        size="sm" 
                        variant="outline"
                        onClick={() => handleBatchSettle(true)}
                        disabled={isBatchSettling}
                        className="border-green-500 text-green-500 hover:bg-green-500/10"
                      >
                        {isBatchSettling ? (
                          <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                        ) : (
                          <CheckCircle className="w-3 h-3 mr-1" />
                        )}
                        All Won
                      </Button>
                      <Button 
                        size="sm" 
                        variant="outline"
                        onClick={() => handleBatchSettle(false)}
                        disabled={isBatchSettling}
                        className="border-red-500 text-red-500 hover:bg-red-500/10"
                      >
                        {isBatchSettling ? (
                          <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                        ) : (
                          <XCircle className="w-3 h-3 mr-1" />
                        )}
                        All Lost
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Parlay List */}
            <div className="space-y-3">
              {parlays.map(parlay => (
                <Card 
                  key={parlay.id}
                  className={selectedParlays.has(parlay.id) ? 'ring-2 ring-primary' : ''}
                >
                  <CardContent className="p-4">
                    <div className="flex gap-3">
                      {!parlay.is_settled && (
                        <div className="pt-1">
                          <Checkbox
                            checked={selectedParlays.has(parlay.id)}
                            onCheckedChange={() => handleToggleParlay(parlay.id)}
                          />
                        </div>
                      )}
                      <div className="flex-1">
                        <div className="flex justify-between items-start mb-2">
                          <div>
                            <p className="text-sm font-medium">{parlay.username || 'Anonymous'}</p>
                            <p className="text-xs text-muted-foreground">
                              {new Date(parlay.created_at).toLocaleDateString()}
                            </p>
                          </div>
                          {parlay.is_settled ? (
                            <Badge variant={parlay.is_won ? "default" : "destructive"}>
                              {parlay.is_won ? 'WON' : 'LOST'}
                            </Badge>
                          ) : (
                            <Badge variant="outline">Pending</Badge>
                          )}
                        </div>
                        <div className="text-xs space-y-1 mb-3">
                          <p>{parlay.legs?.length || 0} legs • ${Number(parlay.stake).toFixed(2)} stake</p>
                          <p className="text-muted-foreground">
                            Potential: ${Number(parlay.potential_payout).toFixed(2)} • 
                            Prob: {(Number(parlay.combined_probability) * 100).toFixed(1)}%
                          </p>
                        </div>
                        {!parlay.is_settled && (
                          <div className="flex gap-2">
                            <Button 
                              size="sm" 
                              variant="outline"
                              onClick={() => handleManualSettle(parlay.id, true)}
                              className="flex-1"
                            >
                              <CheckCircle className="w-3 h-3 mr-1" />
                              Won
                            </Button>
                            <Button 
                              size="sm" 
                              variant="outline"
                              onClick={() => handleManualSettle(parlay.id, false)}
                              className="flex-1"
                            >
                              <XCircle className="w-3 h-3 mr-1" />
                              Lost
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

          {/* Emails Tab */}
          <TabsContent value="emails" className="space-y-3 mt-4">
            <Button onClick={exportEmails} variant="outline" className="w-full">
              <Download className="w-4 h-4 mr-2" />
              Export Emails CSV
            </Button>
            <p className="text-sm text-muted-foreground text-center">
              {emails.filter(e => e.is_subscribed).length} active subscribers
            </p>
            {emails.map(subscriber => (
              <Card key={subscriber.id}>
                <CardContent className="p-4">
                  <div className="flex justify-between items-center">
                    <div>
                      <p className="font-medium text-sm">{subscriber.email}</p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(subscriber.subscribed_at).toLocaleDateString()} • {subscriber.source}
                      </p>
                    </div>
                    <Badge variant={subscriber.is_subscribed ? "default" : "secondary"}>
                      {subscriber.is_subscribed ? 'Active' : 'Unsubscribed'}
                    </Badge>
                  </div>
                </CardContent>
              </Card>
            ))}
          </TabsContent>
        </Tabs>
      </div>

      <BottomNav />
    </div>
  );
}
