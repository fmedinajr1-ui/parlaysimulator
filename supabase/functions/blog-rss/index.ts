// @ts-nocheck
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SITE_URL = "https://parlayfarm.com";

function escapeXml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

Deno.serve(async () => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const { data: posts } = await supabase
    .from("blog_posts")
    .select("slug, title, meta_description, category, published_at")
    .eq("status", "published")
    .order("published_at", { ascending: false })
    .limit(50);

  let xml = `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"><channel>\n`;
  xml += `<title>ParlayFarm Blog — AI Sports Betting Insights</title>\n`;
  xml += `<link>${SITE_URL}/blog</link>\n`;
  xml += `<description>AI-powered sports betting strategy, prop analysis, MVP races, injury updates, and statistical edges.</description>\n`;
  xml += `<language>en-us</language>\n`;
  for (const p of posts || []) {
    const pubDate = new Date(p.published_at).toUTCString();
    xml += `<item>\n`;
    xml += `  <title>${escapeXml(p.title)}</title>\n`;
    xml += `  <link>${SITE_URL}/blog/${p.slug}</link>\n`;
    xml += `  <guid>${SITE_URL}/blog/${p.slug}</guid>\n`;
    xml += `  <description>${escapeXml(p.meta_description)}</description>\n`;
    xml += `  <category>${escapeXml(p.category)}</category>\n`;
    xml += `  <pubDate>${pubDate}</pubDate>\n`;
    xml += `</item>\n`;
  }
  xml += `</channel></rss>`;

  return new Response(xml, {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "public, max-age=1800",
      "Access-Control-Allow-Origin": "*",
    },
  });
});
