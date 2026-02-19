

## Redesign: Sportsbook-Style Homepage Analyzer

Transform the current plain card analyzer into an immersive, sportsbook-inspired experience that feels like DraftKings/FanDuel meets a premium AI tool.

### Design Concept

The analyzer becomes a full-width "stadium-lit" section with animated gradients, a glowing upload zone, and sportsbook-style stat tiles for results -- not just a boring card dropped on the page.

### Visual Upgrades

**1. Section Wrapper (replaces plain Card)**
- Full-width section with dark gradient background (`from-background via-primary/5 to-background`)
- Subtle animated grid/field-line pattern behind (CSS only, no images)
- Centered max-width container with generous padding
- Glowing section border using the existing `neon-border` utility

**2. Header -- Bold Sportsbook Branding**
- Large `font-display` (Bebas Neue) title: "DROP YOUR SLIP" with gradient text (`text-gradient-neon`)
- Animated pulsing dot indicator: "AI-Powered -- Instant Analysis"
- Subtext: "No account needed. Upload or type your parlay."

**3. Input Area -- Sportsbook Drop Zone**
- Upload zone: Large glowing dashed border area with animated `pulse-glow` effect on hover
- Drag & drop visual with a sports-themed icon (camera/upload)
- Mode toggle redesigned as segmented "pill" buttons (like sportsbook tabs for Spread/Total/ML)
- Manual entry: Dark textarea styled like a bet slip input field with monospace-feel font
- "Analyze" CTA button uses the `neon` variant with `animate-pulse-glow`

**4. Results -- Sportsbook Odds Board Style**
- **Risk Badge**: Full-width banner at top with emoji + tier label + animated glow border matching tier color
- **Stats Grid**: Redesigned as 3 "odds tiles" similar to sportsbook prop cards
  - Each tile: Dark card with top label, large bold number, colored accent line at top
  - Win Prob tile: Circular progress ring (CSS `conic-gradient`) instead of plain text
- **Leg Breakdown**: Styled as a sportsbook "bet slip" list
  - Each leg: horizontal card with player name left, odds badge right, implied prob as a mini progress bar
  - Color-coded risk indicators (green/yellow/red accent line on left border)
- **Verdict**: Styled as a "Sharp Alert" banner with icon and gradient background

**5. Premium Upsell -- VIP Gate**
- Replace plain blur with a dramatic "glass" overlay
- Animated border shimmer effect around the locked section
- "UNLOCK ADVANCED ANALYSIS" in display font
- Feature list with checkmark icons: AI Leg Scores, Smart Swaps, Trap Detection
- Big neon CTA button with price badge
- Trust signals: "Powered by proprietary AI models"

**6. Animations**
- Results sections stagger in with `slide-up` delays (existing animation)
- Stats tiles use `bounce-in` on appear
- Win probability ring animates from 0 to value on mount
- Upload zone pulses with `pulse-glow` on idle

### Technical Changes

**`src/components/home/HomepageAnalyzer.tsx`** (rewrite)
- Replace `Card` wrapper with a full-width `section` element
- Add CSS conic-gradient probability ring (pure CSS, no library)
- Sportsbook-style leg cards with left border color indicators
- Segmented pill toggle for input mode
- Enhanced premium gate with shimmer animation
- Staggered `slide-up` animations on result tiles using inline `animationDelay`

**`src/index.css`** (add ~20 lines)
- Add `@keyframes shimmer-border` for the premium gate border effect
- Add `.conic-ring` utility for the probability donut
- Add `.sportsbook-grid` subtle background pattern (CSS repeating-linear-gradient)

### No Other Files Change
- All logic (simulation, checkout, payment verification) stays the same
- Only the visual presentation and CSS are updated
- Same props, same state machine, same edge function calls

### Result
The analyzer transforms from a plain form card into an immersive sportsbook-quality experience with:
- Bold typography and neon accents matching the existing theme
- Animated stat tiles that feel like a live odds board
- A premium feel that justifies the $20 upgrade
- Mobile-first responsive design using existing Tailwind utilities

