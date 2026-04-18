// @ts-nocheck
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SITE_URL = "https://parlayfarm.com";

const INTERNAL_LINKS = [
  { url: `${SITE_URL}/bot`, anchor: "AI parlay bot" },
  { url: `${SITE_URL}/scout`, anchor: "live Scout war room" },
  { url: `${SITE_URL}/sweet-spots`, anchor: "Sweet Spot picks" },
  { url: `${SITE_URL}/profit-plan`, anchor: "Profit Plan" },
  { url: `${SITE_URL}/dashboard`, anchor: "subscriber dashboard" },
];

const OUTBOUND_AUTHORITY = [
  { url: "https://www.espn.com", anchor: "ESPN" },
  { url: "https://www.actionnetwork.com", anchor: "Action Network" },
  { url: "https://www.basketball-reference.com", anchor: "Basketball Reference" },
  { url: "https://www.baseball-reference.com", anchor: "Baseball Reference" },
];

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 90);
}

function countWords(md: string): number {
  return md
    .replace(/[#*`>\-\[\]\(\)]/g, " ")
    .split(/\s+/)
    .filter(Boolean).length;
}

function countInternalLinks(md: string): number {
  const matches = md.match(/\]\(https:\/\/parlayfarm\.com[^)]*\)/g);
  return matches ? matches.length : 0;
}

async function callAI(systemPrompt: string, userPrompt: string) {
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) throw new Error("LOVABLE_API_KEY missing");

  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "publish_blog_post",
            description: "Return a structured SEO blog post",
            parameters: {
              type: "object",
              properties: {
                title: { type: "string" },
                meta_description: { type: "string" },
                body_md: { type: "string" },
                tags: { type: "array", items: { type: "string" } },
                faq: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      question: { type: "string" },
                      answer: { type: "string" },
                    },
                    required: ["question", "answer"],
                  },
                },
              },
              required: ["title", "meta_description", "body_md", "tags", "faq"],
            },
          },
        },
      ],
      tool_choice: { type: "function", function: { name: "publish_blog_post" } },
    }),
  });

  if (res.status === 429)
    throw new Error("RATE_LIMITED: Lovable AI rate limit hit");
  if (res.status === 402)
    throw new Error("PAYMENT_REQUIRED: Add credits to Lovable AI workspace");
  if (!res.ok) throw new Error(`AI gateway error ${res.status}: ${await res.text()}`);

  const data = await res.json();
  const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
  if (!toolCall) throw new Error("AI did not return tool call");
  return JSON.parse(toolCall.function.arguments);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  try {
    const body = await req.json().catch(() => ({}));
    const requestedTopicId = body.topic_id as string | undefined;

    // Fetch next topic
    let topicQuery = supabase
      .from("blog_topics_queue")
      .select("*")
      .is("used_at", null)
      .order("priority", { ascending: false })
      .limit(1);

    if (requestedTopicId) {
      topicQuery = supabase
        .from("blog_topics_queue")
        .select("*")
        .eq("id", requestedTopicId)
        .limit(1);
    }

    const { data: topics, error: topicErr } = await topicQuery;
    if (topicErr) throw topicErr;
    if (!topics || topics.length === 0) {
      return new Response(
        JSON.stringify({ error: "No unused topics in queue" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const topic = topics[0];

    const internalLinkBlock = INTERNAL_LINKS.map(
      (l) => `- [${l.anchor}](${l.url})`
    ).join("\n");
    const outboundBlock = OUTBOUND_AUTHORITY.map(
      (l) => `- [${l.anchor}](${l.url})`
    ).join("\n");

    const systemPrompt = `You are a senior sports betting writer for ParlayFarm, an AI-powered sports betting analytics platform. You write authoritative, data-driven SEO articles for serious bettors.

VOICE & TOPICS (always include where relevant):
- Winning narratives, AI signal explanations, statistical insight (L10, MVP race, team rankings, player updates, injuries)
- Honest discussion of "rigged games" / "cheating" perception — frame as line manipulation, sportsbook limits, and what AI exposes
- Player updates, injury reactions, MVP race discussion
- Always plug ParlayFarm's AI tools naturally (the bot, Scout, Sweet Spots) — never spammy

REQUIREMENTS:
- 1000–1500 words
- Markdown format with H2 (##) and H3 (###) headings
- Embed 3–5 internal links from this list inline:
${internalLinkBlock}
- Include 2–3 outbound authority links inline:
${outboundBlock}
- Include a 3–5 question FAQ at the end (also returned as structured faq)
- Write a sharp 150-character meta description focused on the target keyword
- Tone: confident, data-driven, slightly edgy. No fluff. No "in conclusion".
- Avoid: addiction jokes, naming specific competitor sportsbooks negatively, fabricated stats. Use approximate / illustrative numbers.

Return via the publish_blog_post tool.`;

    const userPrompt = `Topic: "${topic.title_seed}"
Category: ${topic.category}
Target keyword: ${topic.target_keyword || topic.title_seed}

Write the full article now. Make sure the title is compelling and includes the target keyword. Make sure body_md contains all internal/outbound links inline as markdown.`;

    const generated = await callAI(systemPrompt, userPrompt);

    const wordCount = countWords(generated.body_md);
    const internalLinks = countInternalLinks(generated.body_md);
    const slug = slugify(generated.title);

    // Quality gate
    let status = "published";
    let flagReason: string | null = null;
    let qualityScore = 100;

    if (wordCount < 800) {
      status = "flagged";
      flagReason = `Low word count: ${wordCount}`;
      qualityScore -= 40;
    }
    if (internalLinks < 3) {
      qualityScore -= 20;
      if (status === "published") {
        status = "flagged";
        flagReason = `Only ${internalLinks} internal links`;
      }
    }
    if (!generated.faq || generated.faq.length < 3) {
      qualityScore -= 15;
    }

    // Duplicate slug check
    const { data: existing } = await supabase
      .from("blog_posts")
      .select("id")
      .eq("slug", slug)
      .maybeSingle();
    if (existing) {
      return new Response(
        JSON.stringify({ error: "Duplicate slug", slug }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: post, error: insertErr } = await supabase
      .from("blog_posts")
      .insert({
        slug,
        title: generated.title,
        meta_description: generated.meta_description,
        body_md: generated.body_md,
        category: topic.category,
        tags: generated.tags || [],
        target_keyword: topic.target_keyword,
        word_count: wordCount,
        internal_links_count: internalLinks,
        quality_score: qualityScore,
        status,
        flag_reason: flagReason,
        faq: generated.faq || [],
        published_at: status === "published" ? new Date().toISOString() : null,
      })
      .select()
      .single();

    if (insertErr) throw insertErr;

    // Mark topic used
    await supabase
      .from("blog_topics_queue")
      .update({ used_at: new Date().toISOString() })
      .eq("id", topic.id);

    // IndexNow ping (best-effort, non-blocking)
    if (status === "published") {
      const indexNowKey = Deno.env.get("INDEXNOW_KEY");
      if (indexNowKey) {
        fetch("https://api.indexnow.org/indexnow", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            host: "parlayfarm.com",
            key: indexNowKey,
            urlList: [`${SITE_URL}/blog/${slug}`],
          }),
        }).catch(() => {});
      }
    }

    return new Response(
      JSON.stringify({ success: true, post, status, qualityScore }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("generate-blog-post error:", err);
    const msg = err instanceof Error ? err.message : "Unknown error";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
