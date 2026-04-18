-- Blog posts table
CREATE TABLE public.blog_posts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  meta_description TEXT NOT NULL,
  body_md TEXT NOT NULL,
  category TEXT NOT NULL,
  tags TEXT[] DEFAULT '{}',
  target_keyword TEXT,
  hero_image_url TEXT,
  word_count INTEGER NOT NULL DEFAULT 0,
  quality_score NUMERIC DEFAULT 0,
  internal_links_count INTEGER DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft',
  flag_reason TEXT,
  faq JSONB DEFAULT '[]'::jsonb,
  published_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_blog_posts_status_published ON public.blog_posts(status, published_at DESC);
CREATE INDEX idx_blog_posts_category ON public.blog_posts(category);
CREATE INDEX idx_blog_posts_slug ON public.blog_posts(slug);

ALTER TABLE public.blog_posts ENABLE ROW LEVEL SECURITY;

-- Public can read only published posts
CREATE POLICY "Anyone can view published posts"
  ON public.blog_posts FOR SELECT
  USING (status = 'published');

-- Admins can do everything (uses existing has_role)
CREATE POLICY "Admins can manage blog posts"
  ON public.blog_posts FOR ALL
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Topics queue
CREATE TABLE public.blog_topics_queue (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  title_seed TEXT NOT NULL,
  category TEXT NOT NULL,
  target_keyword TEXT,
  priority INTEGER DEFAULT 5,
  used_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_blog_topics_queue_unused ON public.blog_topics_queue(used_at, priority DESC) WHERE used_at IS NULL;

ALTER TABLE public.blog_topics_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage topics queue"
  ON public.blog_topics_queue FOR ALL
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Updated_at trigger
CREATE TRIGGER update_blog_posts_updated_at
  BEFORE UPDATE ON public.blog_posts
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Seed topic queue with ~120 starter ideas spanning the user's content guardrails
-- (winning, AI, stats, cheating/rigged narratives, player updates, injuries, team rankings, L10, MVP)
INSERT INTO public.blog_topics_queue (title_seed, category, target_keyword, priority) VALUES
-- Strategy
('How AI Detects Sportsbook Line Manipulation Before It Hits Public', 'Strategy', 'sportsbook line manipulation', 9),
('The Hidden Math Behind Winning Parlays: An AI Breakdown', 'Strategy', 'winning parlay math', 8),
('Why Most Sports Bettors Lose (And What AI Sees That They Don''t)', 'Strategy', 'why sports bettors lose', 8),
('Bankroll Management: The AI Formula That Beats Kelly Criterion', 'Strategy', 'bankroll management formula', 7),
('Closing Line Value Explained: How Sharp Bettors Use AI', 'Strategy', 'closing line value', 7),
('The 3-Leg Parlay Sweet Spot: Why More Legs Means Less Money', 'Strategy', '3 leg parlay strategy', 8),
('Reverse Line Movement: The AI Signal That Predicts Winners', 'Strategy', 'reverse line movement', 7),
('Hedge Betting With AI: When To Lock In Profit', 'Strategy', 'hedge betting strategy', 6),
('Live Betting Edge: AI vs Sportsbook Algorithms in Real Time', 'Strategy', 'live betting AI', 7),
('Steam Moves Decoded: Following Sharp Money With Machine Learning', 'Strategy', 'steam moves betting', 7),

-- AI Picks
('How Our AI Picked This Week''s Top NBA Player Props', 'AI Picks', 'AI NBA player props', 8),
('AI vs Human Handicappers: A 30-Day Performance Test', 'AI Picks', 'AI sports betting picks', 9),
('Inside the Algorithm: How ParlayFarm Generates Daily Picks', 'AI Picks', 'AI sports betting algorithm', 8),
('The 5 AI Signals That Predict Player Prop Hits', 'AI Picks', 'player prop predictions AI', 7),
('Why Our AI Avoids 80% of Public Betting Trends', 'AI Picks', 'AI sports betting trends', 7),
('Machine Learning Models Used to Beat NBA Totals', 'AI Picks', 'NBA totals AI', 6),
('AI-Powered MLB Strikeout Props: How We Find +EV Bets', 'AI Picks', 'MLB strikeout props AI', 7),
('Tennis Total Games AI Model: Beating ATP and WTA Lines', 'AI Picks', 'tennis betting AI', 6),
('UFC Fight Predictions: An AI Approach to MMA Betting', 'AI Picks', 'UFC betting AI', 6),
('Soccer Goalscorer Props: AI Edges in EPL and MLS', 'AI Picks', 'soccer prop betting AI', 6),

-- Prop Analysis
('Player Props vs Game Lines: Where The Real Edge Lives', 'Prop Analysis', 'player props betting edge', 8),
('Same Game Parlay Math: Why Sportsbooks Love Them', 'Prop Analysis', 'same game parlay strategy', 8),
('Alt Lines Explained: When To Buy Down Stats', 'Prop Analysis', 'alt lines betting', 7),
('Points Rebounds Assists (PRA): The Most Profitable NBA Prop?', 'Prop Analysis', 'PRA prop NBA', 7),
('Stolen Base Props in MLB: An AI-Driven Approach', 'Prop Analysis', 'stolen base props MLB', 6),
('First Inning Home Run Props: The Hidden Edge Most Bettors Miss', 'Prop Analysis', 'first inning HR props', 6),
('RBI Props: Why Unders Win More Than You Think', 'Prop Analysis', 'RBI prop betting', 7),
('Three-Pointer Props: The AI Model That Cracked NBA Shooting', 'Prop Analysis', 'NBA three pointer props', 7),
('Player Strikeout Props: Pitcher Quality vs Lineup Weakness', 'Prop Analysis', 'pitcher strikeout props', 6),
('Anytime Touchdown Props: AI Approach to NFL Scoring', 'Prop Analysis', 'anytime touchdown prop', 7),

-- NBA
('Last 10 Games (L10) Stats: The Ultimate NBA Betting Tool', 'NBA', 'NBA L10 stats betting', 8),
('NBA MVP Race Tracker: AI-Powered Power Rankings', 'NBA', 'NBA MVP race', 8),
('NBA Injury Report Decoder: How To React To Late Scratches', 'NBA', 'NBA injury report betting', 9),
('Back-to-Back NBA Games: The AI Edge In Tired-Legs Spots', 'NBA', 'NBA back to back betting', 7),
('NBA Team Rankings By Offensive Efficiency: Updated Weekly', 'NBA', 'NBA team rankings', 7),
('Home Court Advantage In The NBA: Real Or Overrated?', 'NBA', 'NBA home court advantage', 6),
('NBA Pace Rankings: Why Tempo Determines Totals', 'NBA', 'NBA pace rankings', 7),
('Point Guard Assists Props: The Most Predictable NBA Stat', 'NBA', 'NBA point guard assists', 6),
('Centers vs Position-less Defenses: Where Rebound Props Thrive', 'NBA', 'NBA rebound props', 6),
('NBA Player Updates Live Tracker: AI Reaction To News', 'NBA', 'NBA player updates', 7),

-- MLB
('MLB L10 Hitting Streaks: The Pattern AI Spotted', 'MLB', 'MLB L10 hitting', 7),
('AL MVP Race Predictions Powered By Machine Learning', 'MLB', 'AL MVP predictions', 7),
('MLB Pitcher Vulnerability Index: AI Spots Weak Starts Early', 'MLB', 'MLB pitcher vulnerability', 7),
('Coors Field Effect: How AI Adjusts MLB Totals For Altitude', 'MLB', 'Coors Field betting', 6),
('MLB Injury Report: Daily Bullpen And Lineup Changes That Matter', 'MLB', 'MLB injury report', 8),
('First 5 Innings Betting: Why Sharps Prefer F5 Lines', 'MLB', 'first 5 innings MLB betting', 7),
('MLB Team Pitching Rankings: AI-Tuned For Recent Form', 'MLB', 'MLB pitching rankings', 6),
('Stealing Bases In 2025: The Players AI Says To Bet', 'MLB', 'MLB stolen base leaders', 6),
('Home Run Props: Park Factors The Public Ignores', 'MLB', 'home run prop betting', 7),
('Cy Young Race Trackers: Stats That Decide The Winner', 'MLB', 'Cy Young race', 6),

-- Tennis
('ATP vs WTA Betting: Different Sport, Different Math', 'Tennis', 'ATP WTA betting', 6),
('Tennis Total Games Modeling: AI Adjustments For Surface', 'Tennis', 'tennis total games betting', 7),
('Grand Slam Player Updates: Live AI Tracking Of Form', 'Tennis', 'Grand Slam tennis betting', 6),
('Tennis Injury Report: Why Withdrawals Move Lines Hardest', 'Tennis', 'tennis injury withdrawals', 6),
('First Set Winner Props: The Tennis Bet AI Loves', 'Tennis', 'first set winner tennis', 6),

-- MMA
('UFC Fighter L10 Performance: AI Tracks Camp Quality', 'MMA', 'UFC fighter recent form', 6),
('Method Of Victory Props: AI Models KO vs Decision', 'MMA', 'UFC method of victory', 6),
('UFC Injury Report Tracker: Last-Minute Fight Cancellations', 'MMA', 'UFC injury report', 7),
('Fighter Of The Year Race: AI Power Rankings', 'MMA', 'UFC fighter of the year', 6),

-- Industry / Trust
('Are Sportsbooks Rigged? An AI Audit Of 50,000 Lines', 'Strategy', 'are sportsbooks rigged', 9),
('Cheating In Sports Betting: How Books Limit Sharp Players', 'Strategy', 'sportsbook limits sharp bettors', 8),
('The Truth About FanDuel Boosted Parlays (AI Investigation)', 'Strategy', 'FanDuel boosted parlay value', 8),
('DraftKings Same Game Parlay Hold: The Real Numbers', 'Strategy', 'DraftKings SGP hold', 8),
('Why The House Always Wins: AI Reverse-Engineered The Vig', 'Strategy', 'sportsbook vig explained', 7),
('Trap Lines Exposed: The Bets Sportsbooks Want You To Make', 'Strategy', 'sportsbook trap lines', 8),
('Player Prop Limits: Why Sharp Bettors Get Banned', 'Strategy', 'sportsbook prop limits', 7),

-- Stats deep dives
('Standard Deviation In Sports Betting: An AI-Friendly Guide', 'Strategy', 'sports betting variance', 6),
('What Is +EV Betting? AI Calculates It Better Than You', 'Strategy', 'positive expected value betting', 8),
('Poisson Distribution For Goal Scorers: AI Made Simple', 'Strategy', 'Poisson sports betting', 6),
('Bayesian Updating For Bettors: The AI Method Explained', 'Strategy', 'Bayesian sports betting', 6),
('Monte Carlo Simulations For Parlays: 10,000 Outcomes Tested', 'Strategy', 'Monte Carlo parlay simulation', 6),

-- Player updates / news angles
('Daily Player Updates That Move NBA Lines The Most', 'NBA', 'NBA line movers news', 7),
('How Late Scratches Destroy Same Game Parlays', 'NBA', 'late scratch SGP', 7),
('Star Player Returns From Injury: AI''s First-Game Model', 'NBA', 'NBA injury return betting', 7),
('Trade Deadline Reactions: AI Recalculates Power Rankings', 'NBA', 'NBA trade deadline impact', 6),
('Coaching Changes Mid-Season: How AI Adjusts Team Models', 'NBA', 'NBA coaching change betting', 6),

-- Winning narratives
('From $100 To $10,000: A 90-Day AI Bankroll Challenge', 'AI Picks', 'AI bankroll challenge', 9),
('Biggest ParlayFarm Wins This Month (Verified Tickets)', 'AI Picks', 'biggest parlay wins', 9),
('The Anatomy Of A Winning 10-Leg Parlay: AI Breakdown', 'AI Picks', '10 leg parlay strategy', 8),
('Profit Plan: How AI Generates Consistent Daily Wins', 'AI Picks', 'AI sports betting profit plan', 8),
('Inside The Sweet Spot Engine: Why Edge > Confidence', 'AI Picks', 'sweet spot betting engine', 7),

-- Long tail
('PrizePicks vs Underdog Fantasy: AI Compares The Math', 'Strategy', 'PrizePicks vs Underdog', 7),
('Hard Rock Bet Player Props: The AI Edge Most People Miss', 'Strategy', 'Hard Rock Bet props', 6),
('FanDuel Same Game Parlay AI Optimizer Explained', 'Strategy', 'FanDuel SGP optimizer', 7),
('How To Read A Sportsbook Limit Like AI Does', 'Strategy', 'sportsbook limits explained', 6),
('Confidence Scores In Sports Betting: What They Actually Mean', 'Strategy', 'betting confidence scores', 6),

-- More NBA depth
('NBA Defensive Rating Adjustments: AI Tunes Weekly', 'NBA', 'NBA defensive rating', 6),
('Rest Advantage NBA Betting: 1-Day vs 3-Day Off', 'NBA', 'NBA rest advantage', 6),
('Pace-Adjusted Player Props: The AI Edge', 'NBA', 'pace adjusted props', 6),
('Garbage Time Stats: How AI Filters Junk From Real Production', 'NBA', 'NBA garbage time stats', 6),
('Usage Rate Spikes: The Best Player Prop Indicator', 'NBA', 'NBA usage rate betting', 7),

-- More MLB
('Bullpen Fatigue Index: AI Tracks Reliever Workload', 'MLB', 'MLB bullpen fatigue', 6),
('Weather Impact On MLB Totals: AI Models Wind And Temp', 'MLB', 'MLB weather betting', 7),
('Lineup Protection: Why Batting Order Matters For AI', 'MLB', 'MLB lineup protection', 6),

-- More tennis
('Tiebreak Probability Models: AI For Tennis Bettors', 'Tennis', 'tennis tiebreak betting', 5),
('Serve Hold Percentage Trends: AI Catches Slumping Players', 'Tennis', 'tennis serve hold percentage', 5),

-- More MMA
('Striking Differential As An AI Predictor In UFC', 'MMA', 'UFC striking stats betting', 5),
('Takedown Defense Rankings: An AI Weekly Update', 'MMA', 'UFC takedown defense', 5),

-- Beginners
('Sports Betting For Beginners: Let AI Be Your First Coach', 'Strategy', 'sports betting for beginners', 8),
('How Odds Work: A No-BS AI Guide', 'Strategy', 'how sports betting odds work', 7),
('Moneyline vs Spread vs Total: AI Picks The Best Bet Type', 'Strategy', 'moneyline spread total explained', 7),
('Parlay Calculator: How AI Computes True Payouts', 'Strategy', 'parlay calculator', 7),
('Promo Codes And Bonus Bets: The AI ROI Test', 'Strategy', 'sportsbook bonus bets ROI', 6),

-- Cheating/rigged angle (tasteful, fact-driven)
('Did The Refs Rig The Game? AI Analyzes Suspicious Calls', 'Strategy', 'sports betting referee bias', 7),
('Match-Fixing In Tennis: What AI Pattern Detection Reveals', 'Tennis', 'tennis match fixing detection', 6),
('Insider Trading In Sports Betting: AI Catches The Movements', 'Strategy', 'sports betting insider movement', 7),

-- Team rankings
('Weekly NBA Power Rankings: AI Edition', 'NBA', 'NBA power rankings AI', 7),
('Weekly MLB Power Rankings: AI Edition', 'MLB', 'MLB power rankings AI', 6),
('UFC Pound-For-Pound AI Rankings', 'MMA', 'UFC pound for pound rankings', 6),

-- More AI deep dives
('How ParlayFarm''s 11-Layer Pick DNA Scoring Works', 'AI Picks', 'pick DNA scoring', 8),
('Cross-Engine Validation: Why Multiple AI Models Beat One', 'AI Picks', 'AI ensemble sports betting', 7),
('The Lottery Tier Engine: AI Hunts For Massive Payouts', 'AI Picks', 'lottery parlay AI', 7),
('Gold Signal Engine: The AI Filter For 80%+ Accuracy', 'AI Picks', 'gold signal betting', 7);