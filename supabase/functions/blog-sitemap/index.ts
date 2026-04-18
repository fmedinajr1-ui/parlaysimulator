// @ts-nocheck
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SITE_URL = "https://parlayfarm.com";

Deno.serve(async () => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const { data: posts } = await supabase
    .from("blog_posts")
    .select("slug, updated_at, category")
    .eq("status", "published")
    .order("published_at", { ascending: false });

  const staticUrls = [
    "/",
    "/blog",
    "/bot",
    "/scout",
    "/sweet-spots",
    "/profit-plan",
  ];
  const categories = Array.from(new Set((posts || []).map((p) => p.category)));

  const today = new Date().toISOString().split("T")[0];

  let xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`;
  for (const url of staticUrls) {
    xml += `  <url><loc>${SITE_URL}${url}</loc><lastmod>${today}</lastmod><changefreq>daily</changefreq><priority>0.9</priority></url>\n`;
  }
  for (const cat of categories) {
    const slug = cat.toLowerCase().replace(/\s+/g, "-");
    xml += `  <url><loc>${SITE_URL}/blog/category/${slug}</loc><lastmod>${today}</lastmod><changefreq>daily</changefreq><priority>0.7</priority></url>\n`;
  }
  for (const p of posts || []) {
    const lastmod = (p.updated_at || today).split("T")[0];
    xml += `  <url><loc>${SITE_URL}/blog/${p.slug}</loc><lastmod>${lastmod}</lastmod><changefreq>weekly</changefreq><priority>0.6</priority></url>\n`;
  }
  xml += `</urlset>`;

  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=1800",
      "Access-Control-Allow-Origin": "*",
    },
  });
});
