
The user wants me to test the live blog. This is browser automation work — read-only verification, no code changes needed. I'll just present the plan and on approval switch to default mode to run the browser.

# Verify Blog Renders End-to-End

## What I'll do
1. Open `/blog` at desktop viewport (1366×768) — confirm index loads, posts list, category filters work
2. Click into 2 posts — confirm article body, FAQ, internal links, CTA card render
3. Switch to mobile viewport (390×844) — re-check `/blog` index and 1 post for layout issues
4. Check console for errors during the run

## What I'll report back
- Screenshot of blog index (desktop + mobile)
- Screenshot of 1 article (desktop + mobile)
- Any layout bugs, broken images, console errors, or missing content
- If everything's clean: confirmation + suggested next steps (hero images, homepage feature strip, etc.)

## What I won't do
- Won't edit code unless I find an actual bug
- Won't test admin `/admin/blog` (separate flow)
- Won't click every post — 2-3 is enough to validate the template
