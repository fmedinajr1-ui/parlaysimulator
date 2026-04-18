// @ts-nocheck
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Loader2, RefreshCw, Eye, EyeOff, Trash2, ExternalLink, AlertTriangle } from "lucide-react";
import { Link } from "react-router-dom";
import { format } from "date-fns";

export default function AdminBlog() {
  const [posts, setPosts] = useState<any[]>([]);
  const [queueCount, setQueueCount] = useState({ unused: 0, used: 0 });
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [filter, setFilter] = useState<"all" | "published" | "flagged" | "draft">("all");
  const { toast } = useToast();

  const load = async () => {
    setLoading(true);
    let q = supabase
      .from("blog_posts")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);
    if (filter !== "all") q = q.eq("status", filter);
    const { data } = await q;
    setPosts(data || []);

    const { count: unused } = await supabase
      .from("blog_topics_queue")
      .select("*", { count: "exact", head: true })
      .is("used_at", null);
    const { count: used } = await supabase
      .from("blog_topics_queue")
      .select("*", { count: "exact", head: true })
      .not("used_at", "is", null);
    setQueueCount({ unused: unused || 0, used: used || 0 });
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, [filter]);

  const generateNow = async () => {
    setGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke("generate-blog-post", {
        body: {},
      });
      if (error) throw error;
      toast({
        title: data?.status === "flagged" ? "Generated (flagged for review)" : "Post published",
        description: data?.post?.title || "Done",
      });
      load();
    } catch (err: any) {
      toast({
        title: "Generation failed",
        description: err.message || "Unknown error",
        variant: "destructive",
      });
    } finally {
      setGenerating(false);
    }
  };

  const togglePublish = async (post: any) => {
    const newStatus = post.status === "published" ? "draft" : "published";
    await supabase
      .from("blog_posts")
      .update({
        status: newStatus,
        published_at: newStatus === "published" ? new Date().toISOString() : null,
      })
      .eq("id", post.id);
    load();
  };

  const deletePost = async (id: string) => {
    if (!confirm("Delete this post permanently?")) return;
    await supabase.from("blog_posts").delete().eq("id", id);
    load();
  };

  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold">Blog Manager</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Auto-generated SEO content for parlayfarm.com
          </p>
        </div>
        <Button onClick={generateNow} disabled={generating} size="lg">
          {generating ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <RefreshCw className="w-4 h-4 mr-2" />
          )}
          Generate Post Now
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-4 mb-6">
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold">
              {posts.filter((p) => p.status === "published").length}
            </div>
            <p className="text-xs text-muted-foreground">Published</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold text-yellow-500">
              {posts.filter((p) => p.status === "flagged").length}
            </div>
            <p className="text-xs text-muted-foreground">Flagged</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold">{queueCount.unused}</div>
            <p className="text-xs text-muted-foreground">Topics in queue</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold text-muted-foreground">{queueCount.used}</div>
            <p className="text-xs text-muted-foreground">Topics used</p>
          </CardContent>
        </Card>
      </div>

      <div className="flex gap-2 mb-4">
        {(["all", "published", "flagged", "draft"] as const).map((f) => (
          <Button
            key={f}
            size="sm"
            variant={filter === f ? "default" : "outline"}
            onClick={() => setFilter(f)}
          >
            {f}
          </Button>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Posts</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center py-8 text-muted-foreground">Loading…</div>
          ) : posts.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">No posts.</div>
          ) : (
            <div className="space-y-3">
              {posts.map((p) => (
                <div
                  key={p.id}
                  className="flex items-start justify-between gap-4 p-4 border border-border rounded-lg hover:bg-muted/30"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <Badge
                        variant={
                          p.status === "published"
                            ? "default"
                            : p.status === "flagged"
                              ? "destructive"
                              : "secondary"
                        }
                      >
                        {p.status}
                      </Badge>
                      <Badge variant="outline">{p.category}</Badge>
                      <span className="text-xs text-muted-foreground">
                        {p.word_count} words · {p.internal_links_count} links · score {p.quality_score}
                      </span>
                    </div>
                    <h3 className="font-semibold truncate">{p.title}</h3>
                    <p className="text-xs text-muted-foreground mt-1">
                      {format(new Date(p.created_at), "MMM d, yyyy h:mm a")} · /{p.slug}
                    </p>
                    {p.flag_reason && (
                      <div className="flex items-center gap-1 text-xs text-yellow-500 mt-1">
                        <AlertTriangle className="w-3 h-3" /> {p.flag_reason}
                      </div>
                    )}
                  </div>
                  <div className="flex gap-1 flex-shrink-0">
                    {p.status === "published" && (
                      <Button asChild size="sm" variant="ghost">
                        <Link to={`/blog/${p.slug}`} target="_blank">
                          <ExternalLink className="w-4 h-4" />
                        </Link>
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => togglePublish(p)}
                      title={p.status === "published" ? "Unpublish" : "Publish"}
                    >
                      {p.status === "published" ? (
                        <EyeOff className="w-4 h-4" />
                      ) : (
                        <Eye className="w-4 h-4" />
                      )}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => deletePost(p.id)}
                      className="text-destructive"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
