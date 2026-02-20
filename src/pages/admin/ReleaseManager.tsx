import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useAdminRole } from "@/hooks/useAdminRole";
import { ArrowLeft, Plus, Send, Loader2, Edit2, Trash2, Eye, EyeOff } from "lucide-react";
import { Link, Navigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { FullPageWolfLoader } from "@/components/ui/wolf-loader";

interface Release {
  id: string;
  version: string;
  title: string;
  summary: string;
  body: string | null;
  release_type: string;
  is_published: boolean;
  notifications_sent: boolean;
  created_at: string;
  published_at: string | null;
}

export default function ReleaseManager() {
  const { user } = useAuth();
  const { isAdmin, isLoading: adminLoading } = useAdminRole();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingRelease, setEditingRelease] = useState<Release | null>(null);

  // Form state
  const [version, setVersion] = useState("");
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [body, setBody] = useState("");
  const [releaseType, setReleaseType] = useState("feature");

  const { data: releases, isLoading } = useQuery({
    queryKey: ['admin-releases'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('app_releases')
        .select('*')
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      return data as Release[];
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: { version: string; title: string; summary: string; body: string | null; release_type: string; is_published: boolean; notifications_sent: boolean }) => {
      const { error } = await supabase
        .from('app_releases')
        .insert([data]);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-releases'] });
      resetForm();
      setIsCreateOpen(false);
      toast({ title: "Release created" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<Release> }) => {
      const { error } = await supabase
        .from('app_releases')
        .update(data)
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-releases'] });
      setEditingRelease(null);
      resetForm();
      toast({ title: "Release updated" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('app_releases')
        .delete()
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-releases'] });
      toast({ title: "Release deleted" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const sendNotificationsMutation = useMutation({
    mutationFn: async (releaseId: string) => {
      const { data, error } = await supabase.functions.invoke('send-release-notification', {
        body: { action: 'send_release', release_id: releaseId },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['admin-releases'] });
      toast({ 
        title: "Notifications sent!", 
        description: data.message || `Push: ${data.stats?.pushSent}, Email: ${data.stats?.emailSent}` 
      });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const resetForm = () => {
    setVersion("");
    setTitle("");
    setSummary("");
    setBody("");
    setReleaseType("feature");
  };

  const handleCreate = () => {
    createMutation.mutate({
      version,
      title,
      summary,
      body: body || null,
      release_type: releaseType,
      is_published: false,
      notifications_sent: false,
    });
  };

  const handleEdit = (release: Release) => {
    setEditingRelease(release);
    setVersion(release.version);
    setTitle(release.title);
    setSummary(release.summary);
    setBody(release.body || "");
    setReleaseType(release.release_type);
  };

  const handleUpdate = () => {
    if (!editingRelease) return;
    updateMutation.mutate({
      id: editingRelease.id,
      data: { version, title, summary, body: body || null, release_type: releaseType },
    });
  };

  const togglePublish = (release: Release) => {
    updateMutation.mutate({
      id: release.id,
      data: { 
        is_published: !release.is_published,
        published_at: !release.is_published ? new Date().toISOString() : null,
      },
    });
  };

  // Admin check - redirect non-admins
  if (adminLoading) {
    return <FullPageWolfLoader text="Checking permissions..." />;
  }

  if (!user || !isAdmin) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="min-h-screen bg-background pb-6">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-background/80 backdrop-blur-xl border-b border-border/50">
        <div className="max-w-4xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Link to="/admin" className="p-2 -ml-2 hover:bg-muted/50 rounded-lg transition-colors">
                <ArrowLeft className="w-5 h-5" />
              </Link>
              <div>
                <h1 className="text-lg font-display font-bold">Release Manager</h1>
                <p className="text-xs text-muted-foreground">Create and send release notifications</p>
              </div>
            </div>
            <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
              <DialogTrigger asChild>
                <Button size="sm" onClick={resetForm}>
                  <Plus className="w-4 h-4 mr-2" />
                  New Release
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg">
                <DialogHeader>
                  <DialogTitle>Create New Release</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 pt-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Version</Label>
                      <Input 
                        placeholder="2.4.0" 
                        value={version} 
                        onChange={(e) => setVersion(e.target.value)} 
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Type</Label>
                      <Select value={releaseType} onValueChange={setReleaseType}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="major">🚀 Major</SelectItem>
                          <SelectItem value="feature">✨ Feature</SelectItem>
                          <SelectItem value="improvement">🔧 Improvement</SelectItem>
                          <SelectItem value="bugfix">🐛 Bug Fix</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Title</Label>
                    <Input 
                      placeholder="New AI Parlay Builder" 
                      value={title} 
                      onChange={(e) => setTitle(e.target.value)} 
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Summary (for push notification)</Label>
                    <Textarea 
                      placeholder="Short description for push notifications..." 
                      value={summary} 
                      onChange={(e) => setSummary(e.target.value)}
                      rows={2}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Body (optional, for email & changelog)</Label>
                    <Textarea 
                      placeholder="Detailed release notes..." 
                      value={body} 
                      onChange={(e) => setBody(e.target.value)}
                      rows={4}
                    />
                  </div>
                  <Button 
                    onClick={handleCreate} 
                    disabled={!version || !title || !summary || createMutation.isPending}
                    className="w-full"
                  >
                    {createMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                    Create Release
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </div>
      </div>

      {/* Edit Dialog */}
      <Dialog open={!!editingRelease} onOpenChange={(open) => !open && setEditingRelease(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Release</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Version</Label>
                <Input value={version} onChange={(e) => setVersion(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Type</Label>
                <Select value={releaseType} onValueChange={setReleaseType}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="major">🚀 Major</SelectItem>
                    <SelectItem value="feature">✨ Feature</SelectItem>
                    <SelectItem value="improvement">🔧 Improvement</SelectItem>
                    <SelectItem value="bugfix">🐛 Bug Fix</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Title</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Summary</Label>
              <Textarea value={summary} onChange={(e) => setSummary(e.target.value)} rows={2} />
            </div>
            <div className="space-y-2">
              <Label>Body</Label>
              <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} />
            </div>
            <Button 
              onClick={handleUpdate} 
              disabled={updateMutation.isPending}
              className="w-full"
            >
              {updateMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Save Changes
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Content */}
      <div className="max-w-4xl mx-auto px-4 py-6 space-y-4">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          </div>
        ) : releases?.length === 0 ? (
          <Card className="bg-card/50 border-border/50">
            <CardContent className="py-12 text-center">
              <p className="text-muted-foreground">No releases yet. Create your first one!</p>
            </CardContent>
          </Card>
        ) : (
          releases?.map((release) => (
            <Card key={release.id} className="bg-card/50 border-border/50">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <CardTitle className="text-base">{release.title}</CardTitle>
                      <Badge variant="outline" className="text-xs">v{release.version}</Badge>
                      <Badge variant={release.is_published ? "default" : "secondary"} className="text-xs">
                        {release.is_published ? "Published" : "Draft"}
                      </Badge>
                      {release.notifications_sent && (
                        <Badge variant="outline" className="text-xs text-green-400 border-green-500/30">
                          Notified
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">{release.summary}</p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button 
                      size="icon" 
                      variant="ghost" 
                      onClick={() => togglePublish(release)}
                      title={release.is_published ? "Unpublish" : "Publish"}
                    >
                      {release.is_published ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => handleEdit(release)}>
                      <Edit2 className="w-4 h-4" />
                    </Button>
                    <Button 
                      size="icon" 
                      variant="ghost" 
                      onClick={() => deleteMutation.mutate(release.id)}
                      disabled={deleteMutation.isPending}
                    >
                      <Trash2 className="w-4 h-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">
                    Created {format(new Date(release.created_at), 'MMM d, yyyy')}
                  </span>
                  {release.is_published && !release.notifications_sent && (
                    <Button 
                      size="sm" 
                      onClick={() => sendNotificationsMutation.mutate(release.id)}
                      disabled={sendNotificationsMutation.isPending}
                    >
                      {sendNotificationsMutation.isPending ? (
                        <Loader2 className="w-4 h-4 animate-spin mr-2" />
                      ) : (
                        <Send className="w-4 h-4 mr-2" />
                      )}
                      Send Notifications
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
