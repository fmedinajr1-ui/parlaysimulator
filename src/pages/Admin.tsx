import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useAdminRole } from '@/hooks/useAdminRole';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/hooks/use-toast';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  FileText, 
  Loader2, 
  Shield,
  CheckCircle,
  XCircle,
  RefreshCw,
  Brain,
  Zap,
  TrendingUp,
  Calculator,
  Users,
  Eye,
  BarChart3,
  ChevronRight,
  ChevronLeft,
  Settings,
  Clock,
  ArrowLeft,
  Target,
  Sparkles,
  Mail
} from 'lucide-react';
import { AILearningDashboard } from '@/components/admin/AILearningDashboard';
import { SharpMoneyPanel } from '@/components/admin/SharpMoneyPanel';
import { GodModeDashboard } from '@/components/upsets/GodModeDashboard';
import SharpLineCalculator from '@/components/admin/SharpLineCalculator';
import { MovementAccuracyDashboard } from '@/components/admin/MovementAccuracyDashboard';
import { UserDirectoryManager } from '@/components/admin/UserDirectoryManager';
import { MasterAccuracyDashboard } from '@/components/admin/accuracy/MasterAccuracyDashboard';
import { SharpRecalibrationPanel } from '@/components/admin/SharpRecalibrationPanel';
import { CalibrationFactorsPanel } from '@/components/admin/CalibrationFactorsPanel';
import { CronJobHistoryPanel } from '@/components/admin/CronJobHistoryPanel';
import { UnifiedAccuracyDashboard } from '@/components/admin/UnifiedAccuracyDashboard';
import { SharpEngineV2Card } from '@/components/sharp/SharpEngineV2Card';
import { SharpEngineConfigPanel } from '@/components/admin/SharpEngineConfigPanel';
import { AIGenerativeProgressDashboard } from '@/components/admin/AIGenerativeProgressDashboard';
import { AllSportsTracker } from '@/components/tracker/AllSportsTracker';

import { GodModeWeightsPanel } from '@/components/admin/GodModeWeightsPanel';
import { SlipImageViewer } from '@/components/admin/SlipImageViewer';
import { FeatureAccessManager } from '@/components/admin/FeatureAccessManager';

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
  slip_image_url: string | null;
}

type AdminSection = 
  | 'overview'
  | 'accuracy' 
  | 'ai-learning' 
  | 'ai-generator'
  | 'sharp-engine' 
  | 'movement' 
  | 'users' 
  | 'parlays'
  | 'god-mode'
  | 'tracker';

const sectionConfig = [
  {
    id: 'ai-generator' as AdminSection,
    title: 'AI Parlay Generator',
    description: 'Self-learning parlay generation toward 65% accuracy',
    icon: Sparkles,
    color: 'text-cyan-500'
  },
  {
    id: 'accuracy' as AdminSection,
    title: 'Analytics & Accuracy',
    description: 'Track prediction performance and calibration',
    icon: BarChart3,
    color: 'text-blue-500'
  },
  {
    id: 'ai-learning' as AdminSection,
    title: 'AI & Learning',
    description: 'Machine learning insights and performance',
    icon: Brain,
    color: 'text-purple-500'
  },
  {
    id: 'sharp-engine' as AdminSection,
    title: 'Sharp Money Engine',
    description: 'Configure and monitor sharp action detection',
    icon: Zap,
    color: 'text-yellow-500'
  },
  {
    id: 'movement' as AdminSection,
    title: 'Movement Analysis',
    description: 'Line movement tracking and accuracy',
    icon: TrendingUp,
    color: 'text-green-500'
  },
  {
    id: 'users' as AdminSection,
    title: 'User Management',
    description: 'Collaborators and access control',
    icon: Users,
    color: 'text-orange-500'
  },
  {
    id: 'parlays' as AdminSection,
    title: 'Parlay Management',
    description: 'Settle and manage user parlays',
    icon: FileText,
    color: 'text-pink-500'
  },
  {
    id: 'god-mode' as AdminSection,
    title: 'God Mode Dashboard',
    description: 'Upset predictions and chaos mode analysis',
    icon: Target,
    color: 'text-purple-500'
  },
  {
    id: 'tracker' as AdminSection,
    title: 'All-Sports Tracker',
    description: 'Real-time picks from all engines',
    icon: Eye,
    color: 'text-emerald-500'
  },
];

export default function Admin() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { isAdmin, isLoading: isCheckingAdmin } = useAdminRole();
  const { toast } = useToast();
  
  const [parlays, setParlays] = useState<ParlayData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSettling, setIsSettling] = useState(false);
  const [activeSection, setActiveSection] = useState<AdminSection>('overview');
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

  // Overview Section - Card Grid
  if (activeSection === 'overview') {
    return (
      <div className="min-h-dvh bg-background pb-nav-safe">
        {/* Header */}
        <div className="bg-card border-b border-border p-4">
          <div className="flex items-center gap-3">
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={() => navigate('/')}
              className="p-2 h-auto"
            >
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div className="p-2 rounded-xl bg-primary/10">
              <Shield className="w-6 h-6 text-primary" />
            </div>
            <div>
              <h1 className="font-display text-xl text-foreground">Admin Panel</h1>
              <p className="text-sm text-muted-foreground">System management and analytics</p>
            </div>
          </div>
        </div>

        <div className="p-6 space-y-6">
          {/* Quick Stats */}
          <div className="grid grid-cols-3 gap-3">
            <Card className="bg-card/50">
              <CardContent className="p-4 text-center">
                <p className="text-2xl font-bold text-foreground">{totalParlays}</p>
                <p className="text-xs text-muted-foreground">Total Parlays</p>
              </CardContent>
            </Card>
            <Card className="bg-card/50">
              <CardContent className="p-4 text-center">
                <p className="text-2xl font-bold text-green-500">{settledParlays}</p>
                <p className="text-xs text-muted-foreground">Settled</p>
              </CardContent>
            </Card>
            <Card className="bg-card/50">
              <CardContent className="p-4 text-center">
                <p className="text-2xl font-bold text-yellow-500">{pendingParlays}</p>
                <p className="text-xs text-muted-foreground">Pending</p>
              </CardContent>
            </Card>
          </div>

          {/* Quick Actions */}
          <Card className="bg-card/50 border-primary/20">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Settings className="w-4 h-4" />
                Quick Actions
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <Button 
                onClick={() => navigate('/verify-email?test=true')}
                variant="outline"
                size="sm"
                className="gap-2"
              >
                <Mail className="w-4 h-4" />
                Test Email Verification
              </Button>
            </CardContent>
          </Card>

          {/* Section Navigation Cards */}
          <div className="space-y-3">
            <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
              Admin Sections
            </h2>
            <div className="grid gap-3">
              {sectionConfig.map((section) => (
                <Card 
                  key={section.id}
                  className="cursor-pointer hover:bg-muted/30 transition-colors active:scale-[0.99]"
                  onClick={() => setActiveSection(section.id)}
                >
                  <CardContent className="p-4 flex items-center gap-4">
                    <div className={`p-3 rounded-xl bg-muted/50 ${section.color}`}>
                      <section.icon className="w-5 h-5" />
                    </div>
                    <div className="flex-1">
                      <h3 className="font-medium text-foreground">{section.title}</h3>
                      <p className="text-sm text-muted-foreground">{section.description}</p>
                    </div>
                    <ChevronRight className="w-5 h-5 text-muted-foreground" />
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Sub-section Views
  const renderSectionContent = () => {
    switch (activeSection) {
      case 'accuracy':
        return (
          <div className="space-y-6">
            <UnifiedAccuracyDashboard />
            <MasterAccuracyDashboard />
          </div>
        );
      
      case 'ai-learning':
        return <AILearningDashboard />;
      
      case 'ai-generator':
        return <AIGenerativeProgressDashboard />;
      
      case 'sharp-engine':
        return (
          <div className="space-y-6">
            <SharpEngineConfigPanel />
            <SharpEngineV2Card limit={20} />
            <SharpRecalibrationPanel />
            <CronJobHistoryPanel />
            <CalibrationFactorsPanel />
            <SharpMoneyPanel />
          </div>
        );
      
      case 'movement':
        return (
          <div className="space-y-6">
            <MovementAccuracyDashboard />
            <SharpLineCalculator />
          </div>
        );
      
      case 'users':
        return (
          <div className="space-y-6">
            {/* Unified User & Access Manager */}
            <FeatureAccessManager />
            
            {/* User Directory for detailed stats */}
            <UserDirectoryManager />
          </div>
        );
      
      case 'god-mode':
        return (
          <div className="space-y-6">
            <GodModeWeightsPanel />
            <GodModeDashboard />
          </div>
        );
      
      case 'tracker':
        return <AllSportsTracker />;
      
      case 'parlays':
        return (
          <div className="space-y-4">
            {/* Stats */}
            <div className="grid grid-cols-3 gap-3">
              <Card>
                <CardContent className="p-4 text-center">
                  <p className="text-2xl font-bold">{totalParlays}</p>
                  <p className="text-xs text-muted-foreground">Total</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4 text-center">
                  <p className="text-2xl font-bold text-green-500">{settledParlays}</p>
                  <p className="text-xs text-muted-foreground">Settled</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4 text-center">
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
              size="lg"
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
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Checkbox 
                        checked={selectedParlays.size === pendingParlaysList.length && pendingParlaysList.length > 0}
                        onCheckedChange={handleSelectAll}
                      />
                      <span className="text-sm font-medium">Select All Pending ({pendingParlays})</span>
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
                <CardContent className="p-4">
                  <div className="flex items-center justify-between gap-3">
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
                    <div className="flex gap-4">
                      {/* Slip Image Thumbnail */}
                      <SlipImageViewer imageUrl={parlay.slip_image_url} />
                      
                      {!parlay.is_settled && (
                        <div className="pt-1">
                          <Checkbox
                            checked={selectedParlays.has(parlay.id)}
                            onCheckedChange={() => handleToggleParlay(parlay.id)}
                          />
                        </div>
                      )}
                      <div className="flex-1">
                        <div className="flex justify-between items-start mb-3">
                          <div>
                            <p className="font-medium">{parlay.username || 'Anonymous'}</p>
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
                        <div className="text-sm space-y-1 mb-4">
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
                              className="flex-1 border-green-500 text-green-500 hover:bg-green-500/10"
                            >
                              <CheckCircle className="w-3 h-3 mr-1" />
                              Won
                            </Button>
                            <Button 
                              size="sm" 
                              variant="outline" 
                              onClick={() => handleManualSettle(parlay.id, false)}
                              className="flex-1 border-red-500 text-red-500 hover:bg-red-500/10"
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
          </div>
        );



      default:
        return null;
    }
  };

  const currentSection = sectionConfig.find(s => s.id === activeSection);

  return (
    <div className="min-h-dvh bg-background pb-nav-safe">
      {/* Header with Back Button */}
      <div className="bg-card border-b border-border p-4">
        <div className="flex items-center gap-3">
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={() => setActiveSection('overview')}
            className="p-2 h-auto"
          >
            <ArrowLeft className="w-5 h-5" />
          </Button>
          {currentSection && (
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-lg bg-muted/50 ${currentSection.color}`}>
                <currentSection.icon className="w-5 h-5" />
              </div>
              <div>
                <h1 className="font-display text-lg text-foreground">{currentSection.title}</h1>
                <p className="text-xs text-muted-foreground">{currentSection.description}</p>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="p-4">
        {renderSectionContent()}
      </div>
    </div>
  );
}
