import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useAdminRole } from '@/hooks/useAdminRole';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
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
  Upload
} from 'lucide-react';
import { BottomNav } from '@/components/BottomNav';
import { AILearningDashboard } from '@/components/admin/AILearningDashboard';
import { BulkSlipUpload } from '@/components/admin/BulkSlipUpload';

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
    if (isAdmin) {
      fetchAdminData();
    }
  }, [isAdmin]);

  const fetchAdminData = async () => {
    setIsLoading(true);
    try {
      // Fetch parlays
      const { data: parlaysData, error: parlaysError } = await supabase.rpc('get_all_parlays_admin');
      if (parlaysError) throw parlaysError;
      const typedParlays = (parlaysData || []).map((p: Record<string, unknown>) => ({
        ...p,
        legs: p.legs as Array<{ description: string; odds: number }>
      })) as ParlayData[];
      setParlays(typedParlays);

      // Fetch email subscribers
      const { data: emailsData, error: emailsError } = await supabase
        .from('email_subscribers')
        .select('*')
        .order('subscribed_at', { ascending: false });
      if (emailsError) throw emailsError;
      setEmails(emailsData || []);

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
    <div className="min-h-screen bg-background pb-20">
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
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="ai-learning" className="text-xs">
              <Brain className="w-3 h-3 mr-1" />
              AI
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

            {/* Parlay List */}
            <div className="space-y-3">
              {parlays.map(parlay => (
                <Card key={parlay.id}>
                  <CardContent className="p-4">
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
