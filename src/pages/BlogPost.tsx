// @ts-nocheck
import { useEffect, useState } from "react";
import { Link, useParams, Navigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Seo } from "@/components/seo/Seo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Calendar, ArrowLeft, Sparkles } from "lucide-react";
import { format } from "date-fns";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface FaqItem {
  question: string;
  answer: string;
}

interface BlogPost {
  id: string;
  slug: string;
  title: string;
  meta_description: string;
  body_md: string;
  category: string;
  tags: string[];
  hero_image_url: string | null;
  published_at: string;
  updated_at: string;
  faq: FaqItem[];
}

export default function BlogPost() {
  const { slug } = useParams<{ slug: string }>();
  const [post, setPost] = useState<BlogPost | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!slug) return;
    supabase
      .from("blog_posts")
      .select("*")
      .eq("slug", slug)
      .eq("status", "published")
      .maybeSingle()
      .then(({ data }) => {
        if (!data) setNotFound(true);
        else setPost(data as BlogPost);
        setLoading(false);
      });
  }, [slug]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">
        Loading…
      </div>
    );
  }
  if (notFound || !post) return <Navigate to="/blog" replace />;

  const canonical = `https://parlayfarm.com/blog/${post.slug}`;
  const articleLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: post.title,
    description: post.meta_description,
    author: { "@type": "Organization", name: "ParlayFarm AI" },
    publisher: {
      "@type": "Organization",
      name: "ParlayFarm",
      logo: {
        "@type": "ImageObject",
        url: "https://parlayfarm.com/parlay-farm-logo.png",
      },
    },
    datePublished: post.published_at,
    dateModified: post.updated_at,
    mainEntityOfPage: canonical,
    articleSection: post.category,
    keywords: (post.tags || []).join(", "),
  };
  const breadcrumbLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: "https://parlayfarm.com/" },
      { "@type": "ListItem", position: 2, name: "Blog", item: "https://parlayfarm.com/blog" },
      { "@type": "ListItem", position: 3, name: post.title, item: canonical },
    ],
  };
  const faqLd =
    post.faq && post.faq.length > 0
      ? {
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: post.faq.map((f) => ({
            "@type": "Question",
            name: f.question,
            acceptedAnswer: { "@type": "Answer", text: f.answer },
          })),
        }
      : null;

  const jsonLd = [articleLd, breadcrumbLd, ...(faqLd ? [faqLd] : [])];

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Seo
        title={`${post.title} | ParlayFarm Blog`}
        description={post.meta_description}
        canonical={canonical}
        type="article"
        publishedTime={post.published_at}
        jsonLd={jsonLd}
      />

      <article className="container mx-auto px-4 py-12 max-w-3xl">
        <Link
          to="/blog"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-6"
        >
          <ArrowLeft className="w-4 h-4" /> All Articles
        </Link>

        <Badge variant="secondary" className="mb-4">
          {post.category}
        </Badge>
        <h1 className="text-3xl md:text-5xl font-bold leading-tight tracking-tight">
          {post.title}
        </h1>

        <div className="flex items-center gap-3 text-sm text-muted-foreground mt-4">
          <Calendar className="w-4 h-4" />
          <time dateTime={post.published_at}>
            {format(new Date(post.published_at), "MMMM d, yyyy")}
          </time>
        </div>

        <div className="prose prose-invert max-w-none mt-8 prose-headings:tracking-tight prose-a:text-primary prose-a:no-underline hover:prose-a:underline prose-strong:text-foreground">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{post.body_md}</ReactMarkdown>
        </div>

        {post.faq && post.faq.length > 0 && (
          <section className="mt-12 pt-8 border-t border-border/40">
            <h2 className="text-2xl font-bold mb-6">Frequently Asked Questions</h2>
            <div className="space-y-4">
              {post.faq.map((f, i) => (
                <Card key={i}>
                  <CardContent className="p-5">
                    <h3 className="font-semibold mb-2">{f.question}</h3>
                    <p className="text-sm text-muted-foreground">{f.answer}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>
        )}

        <Card className="mt-12 bg-gradient-to-br from-primary/10 to-accent/10 border-primary/30">
          <CardContent className="p-6 flex flex-col sm:flex-row items-start sm:items-center gap-4">
            <Sparkles className="w-8 h-8 text-primary flex-shrink-0" />
            <div className="flex-1">
              <h3 className="font-bold text-lg">Want the AI to do the work?</h3>
              <p className="text-sm text-muted-foreground">
                ParlayFarm&apos;s AI builds daily parlays, scans live games, and finds Sweet Spots automatically.
              </p>
            </div>
            <Button asChild size="lg">
              <Link to="/bot">Try the Bot →</Link>
            </Button>
          </CardContent>
        </Card>

        {post.tags && post.tags.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-8">
            {post.tags.map((t) => (
              <Badge key={t} variant="outline">
                {t}
              </Badge>
            ))}
          </div>
        )}
      </article>
    </div>
  );
}
