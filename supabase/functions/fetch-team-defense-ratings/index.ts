import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Position groups for matchup analysis
type PositionGroup = 'guards' | 'wings' | 'bigs' | 'all';

// Enhanced defensive ratings with position-specific data
interface TeamDefenseRating {
  team_name: string;
  team_abbrev: string;
  // Overall ratings
  points_rank: number;
  points_allowed: number;
  rebounds_rank: number;
  rebounds_allowed: number;
  assists_rank: number;
  assists_allowed: number;
  threes_rank: number;
  threes_allowed: number;
  // Position-specific: Points allowed
  pts_to_guards_rank: number;
  pts_to_guards_allowed: number;
  pts_to_wings_rank: number;
  pts_to_wings_allowed: number;
  pts_to_bigs_rank: number;
  pts_to_bigs_allowed: number;
  // Position-specific: Rebounds allowed
  reb_to_guards_rank: number;
  reb_to_guards_allowed: number;
  reb_to_wings_rank: number;
  reb_to_wings_allowed: number;
  reb_to_bigs_rank: number;
  reb_to_bigs_allowed: number;
  // Position-specific: Assists allowed
  ast_to_guards_rank: number;
  ast_to_guards_allowed: number;
  ast_to_wings_rank: number;
  ast_to_wings_allowed: number;
  ast_to_bigs_rank: number;
  ast_to_bigs_allowed: number;
}

// Current 2024-25 defensive ratings with position-specific data
// Guards = PG/SG, Wings = SF/SG-SF, Bigs = PF/C
const NBA_DEFENSE_RATINGS: TeamDefenseRating[] = [
  { 
    team_name: 'Cleveland Cavaliers', team_abbrev: 'CLE', 
    points_rank: 1, points_allowed: 105.2, rebounds_rank: 5, rebounds_allowed: 42.1, assists_rank: 3, assists_allowed: 23.4, threes_rank: 2, threes_allowed: 11.2,
    pts_to_guards_rank: 2, pts_to_guards_allowed: 18.5, pts_to_wings_rank: 3, pts_to_wings_allowed: 16.2, pts_to_bigs_rank: 4, pts_to_bigs_allowed: 21.8,
    reb_to_guards_rank: 8, reb_to_guards_allowed: 3.2, reb_to_wings_rank: 4, reb_to_wings_allowed: 5.1, reb_to_bigs_rank: 3, reb_to_bigs_allowed: 9.8,
    ast_to_guards_rank: 2, ast_to_guards_allowed: 5.8, ast_to_wings_rank: 5, ast_to_wings_allowed: 3.2, ast_to_bigs_rank: 6, ast_to_bigs_allowed: 2.8
  },
  { 
    team_name: 'Oklahoma City Thunder', team_abbrev: 'OKC', 
    points_rank: 2, points_allowed: 106.8, rebounds_rank: 8, rebounds_allowed: 43.5, assists_rank: 1, assists_allowed: 22.8, threes_rank: 4, threes_allowed: 11.8,
    pts_to_guards_rank: 1, pts_to_guards_allowed: 17.8, pts_to_wings_rank: 5, pts_to_wings_allowed: 16.8, pts_to_bigs_rank: 6, pts_to_bigs_allowed: 22.5,
    reb_to_guards_rank: 5, reb_to_guards_allowed: 3.0, reb_to_wings_rank: 8, reb_to_wings_allowed: 5.5, reb_to_bigs_rank: 10, reb_to_bigs_allowed: 10.5,
    ast_to_guards_rank: 1, ast_to_guards_allowed: 5.5, ast_to_wings_rank: 3, ast_to_wings_allowed: 3.0, ast_to_bigs_rank: 4, ast_to_bigs_allowed: 2.6
  },
  { 
    team_name: 'Boston Celtics', team_abbrev: 'BOS', 
    points_rank: 3, points_allowed: 108.1, rebounds_rank: 3, rebounds_allowed: 41.2, assists_rank: 6, assists_allowed: 24.1, threes_rank: 1, threes_allowed: 10.9,
    pts_to_guards_rank: 4, pts_to_guards_allowed: 19.2, pts_to_wings_rank: 1, pts_to_wings_allowed: 15.5, pts_to_bigs_rank: 5, pts_to_bigs_allowed: 22.2,
    reb_to_guards_rank: 3, reb_to_guards_allowed: 2.8, reb_to_wings_rank: 2, reb_to_wings_allowed: 4.8, reb_to_bigs_rank: 4, reb_to_bigs_allowed: 9.9,
    ast_to_guards_rank: 5, ast_to_guards_allowed: 6.2, ast_to_wings_rank: 4, ast_to_wings_allowed: 3.1, ast_to_bigs_rank: 8, ast_to_bigs_allowed: 3.0
  },
  { 
    team_name: 'Houston Rockets', team_abbrev: 'HOU', 
    points_rank: 4, points_allowed: 108.5, rebounds_rank: 2, rebounds_allowed: 40.8, assists_rank: 4, assists_allowed: 23.6, threes_rank: 5, threes_allowed: 12.1,
    pts_to_guards_rank: 6, pts_to_guards_allowed: 19.8, pts_to_wings_rank: 4, pts_to_wings_allowed: 16.5, pts_to_bigs_rank: 2, pts_to_bigs_allowed: 20.8,
    reb_to_guards_rank: 2, reb_to_guards_allowed: 2.7, reb_to_wings_rank: 3, reb_to_wings_allowed: 5.0, reb_to_bigs_rank: 1, reb_to_bigs_allowed: 9.2,
    ast_to_guards_rank: 4, ast_to_guards_allowed: 6.0, ast_to_wings_rank: 6, ast_to_wings_allowed: 3.3, ast_to_bigs_rank: 3, ast_to_bigs_allowed: 2.5
  },
  { 
    team_name: 'Memphis Grizzlies', team_abbrev: 'MEM', 
    points_rank: 5, points_allowed: 109.2, rebounds_rank: 10, rebounds_allowed: 44.2, assists_rank: 8, assists_allowed: 24.5, threes_rank: 7, threes_allowed: 12.5,
    pts_to_guards_rank: 3, pts_to_guards_allowed: 18.8, pts_to_wings_rank: 8, pts_to_wings_allowed: 17.5, pts_to_bigs_rank: 8, pts_to_bigs_allowed: 23.0,
    reb_to_guards_rank: 12, reb_to_guards_allowed: 3.5, reb_to_wings_rank: 10, reb_to_wings_allowed: 5.8, reb_to_bigs_rank: 8, reb_to_bigs_allowed: 10.2,
    ast_to_guards_rank: 7, ast_to_guards_allowed: 6.5, ast_to_wings_rank: 8, ast_to_wings_allowed: 3.5, ast_to_bigs_rank: 10, ast_to_bigs_allowed: 3.2
  },
  { 
    team_name: 'Orlando Magic', team_abbrev: 'ORL', 
    points_rank: 6, points_allowed: 109.5, rebounds_rank: 1, rebounds_allowed: 40.1, assists_rank: 2, assists_allowed: 23.1, threes_rank: 3, threes_allowed: 11.5,
    pts_to_guards_rank: 5, pts_to_guards_allowed: 19.5, pts_to_wings_rank: 2, pts_to_wings_allowed: 15.8, pts_to_bigs_rank: 10, pts_to_bigs_allowed: 23.5,
    reb_to_guards_rank: 1, reb_to_guards_allowed: 2.5, reb_to_wings_rank: 1, reb_to_wings_allowed: 4.5, reb_to_bigs_rank: 2, reb_to_bigs_allowed: 9.5,
    ast_to_guards_rank: 3, ast_to_guards_allowed: 5.9, ast_to_wings_rank: 2, ast_to_wings_allowed: 2.9, ast_to_bigs_rank: 2, ast_to_bigs_allowed: 2.4
  },
  { 
    team_name: 'Minnesota Timberwolves', team_abbrev: 'MIN', 
    points_rank: 7, points_allowed: 109.8, rebounds_rank: 6, rebounds_allowed: 42.8, assists_rank: 5, assists_allowed: 23.9, threes_rank: 6, threes_allowed: 12.3,
    pts_to_guards_rank: 8, pts_to_guards_allowed: 20.2, pts_to_wings_rank: 6, pts_to_wings_allowed: 17.0, pts_to_bigs_rank: 3, pts_to_bigs_allowed: 21.2,
    reb_to_guards_rank: 6, reb_to_guards_allowed: 3.1, reb_to_wings_rank: 6, reb_to_wings_allowed: 5.3, reb_to_bigs_rank: 6, reb_to_bigs_allowed: 10.0,
    ast_to_guards_rank: 6, ast_to_guards_allowed: 6.3, ast_to_wings_rank: 7, ast_to_wings_allowed: 3.4, ast_to_bigs_rank: 5, ast_to_bigs_allowed: 2.7
  },
  { 
    team_name: 'New York Knicks', team_abbrev: 'NYK', 
    points_rank: 8, points_allowed: 110.2, rebounds_rank: 4, rebounds_allowed: 41.8, assists_rank: 10, assists_allowed: 24.8, threes_rank: 9, threes_allowed: 12.8,
    pts_to_guards_rank: 7, pts_to_guards_allowed: 20.0, pts_to_wings_rank: 7, pts_to_wings_allowed: 17.2, pts_to_bigs_rank: 7, pts_to_bigs_allowed: 22.8,
    reb_to_guards_rank: 4, reb_to_guards_allowed: 2.9, reb_to_wings_rank: 5, reb_to_wings_allowed: 5.2, reb_to_bigs_rank: 5, reb_to_bigs_allowed: 9.9,
    ast_to_guards_rank: 10, ast_to_guards_allowed: 6.8, ast_to_wings_rank: 10, ast_to_wings_allowed: 3.7, ast_to_bigs_rank: 9, ast_to_bigs_allowed: 3.1
  },
  { 
    team_name: 'Denver Nuggets', team_abbrev: 'DEN', 
    points_rank: 9, points_allowed: 110.5, rebounds_rank: 12, rebounds_allowed: 44.8, assists_rank: 7, assists_allowed: 24.3, threes_rank: 8, threes_allowed: 12.6,
    pts_to_guards_rank: 10, pts_to_guards_allowed: 20.8, pts_to_wings_rank: 9, pts_to_wings_allowed: 17.8, pts_to_bigs_rank: 9, pts_to_bigs_allowed: 23.2,
    reb_to_guards_rank: 10, reb_to_guards_allowed: 3.4, reb_to_wings_rank: 12, reb_to_wings_allowed: 6.0, reb_to_bigs_rank: 12, reb_to_bigs_allowed: 10.8,
    ast_to_guards_rank: 8, ast_to_guards_allowed: 6.6, ast_to_wings_rank: 9, ast_to_wings_allowed: 3.6, ast_to_bigs_rank: 7, ast_to_bigs_allowed: 2.9
  },
  { 
    team_name: 'Milwaukee Bucks', team_abbrev: 'MIL', 
    points_rank: 10, points_allowed: 110.8, rebounds_rank: 9, rebounds_allowed: 43.8, assists_rank: 12, assists_allowed: 25.2, threes_rank: 10, threes_allowed: 13.0,
    pts_to_guards_rank: 9, pts_to_guards_allowed: 20.5, pts_to_wings_rank: 10, pts_to_wings_allowed: 18.0, pts_to_bigs_rank: 11, pts_to_bigs_allowed: 23.8,
    reb_to_guards_rank: 9, reb_to_guards_allowed: 3.3, reb_to_wings_rank: 9, reb_to_wings_allowed: 5.6, reb_to_bigs_rank: 9, reb_to_bigs_allowed: 10.3,
    ast_to_guards_rank: 12, ast_to_guards_allowed: 7.0, ast_to_wings_rank: 12, ast_to_wings_allowed: 3.9, ast_to_bigs_rank: 11, ast_to_bigs_allowed: 3.3
  },
  { 
    team_name: 'Los Angeles Lakers', team_abbrev: 'LAL', 
    points_rank: 11, points_allowed: 111.2, rebounds_rank: 11, rebounds_allowed: 44.5, assists_rank: 9, assists_allowed: 24.6, threes_rank: 12, threes_allowed: 13.2,
    pts_to_guards_rank: 11, pts_to_guards_allowed: 21.0, pts_to_wings_rank: 11, pts_to_wings_allowed: 18.2, pts_to_bigs_rank: 12, pts_to_bigs_allowed: 24.0,
    reb_to_guards_rank: 11, reb_to_guards_allowed: 3.4, reb_to_wings_rank: 11, reb_to_wings_allowed: 5.9, reb_to_bigs_rank: 11, reb_to_bigs_allowed: 10.6,
    ast_to_guards_rank: 9, ast_to_guards_allowed: 6.7, ast_to_wings_rank: 11, ast_to_wings_allowed: 3.8, ast_to_bigs_rank: 12, ast_to_bigs_allowed: 3.4
  },
  { 
    team_name: 'Golden State Warriors', team_abbrev: 'GSW', 
    points_rank: 12, points_allowed: 111.5, rebounds_rank: 14, rebounds_allowed: 45.2, assists_rank: 11, assists_allowed: 25.0, threes_rank: 11, threes_allowed: 13.1,
    pts_to_guards_rank: 12, pts_to_guards_allowed: 21.2, pts_to_wings_rank: 12, pts_to_wings_allowed: 18.5, pts_to_bigs_rank: 13, pts_to_bigs_allowed: 24.2,
    reb_to_guards_rank: 14, reb_to_guards_allowed: 3.6, reb_to_wings_rank: 14, reb_to_wings_allowed: 6.2, reb_to_bigs_rank: 14, reb_to_bigs_allowed: 11.0,
    ast_to_guards_rank: 11, ast_to_guards_allowed: 6.9, ast_to_wings_rank: 13, ast_to_wings_allowed: 4.0, ast_to_bigs_rank: 13, ast_to_bigs_allowed: 3.5
  },
  { 
    team_name: 'Miami Heat', team_abbrev: 'MIA', 
    points_rank: 13, points_allowed: 111.8, rebounds_rank: 7, rebounds_allowed: 43.2, assists_rank: 14, assists_allowed: 25.5, threes_rank: 14, threes_allowed: 13.5,
    pts_to_guards_rank: 14, pts_to_guards_allowed: 21.8, pts_to_wings_rank: 13, pts_to_wings_allowed: 18.8, pts_to_bigs_rank: 14, pts_to_bigs_allowed: 24.5,
    reb_to_guards_rank: 7, reb_to_guards_allowed: 3.2, reb_to_wings_rank: 7, reb_to_wings_allowed: 5.4, reb_to_bigs_rank: 7, reb_to_bigs_allowed: 10.1,
    ast_to_guards_rank: 14, ast_to_guards_allowed: 7.2, ast_to_wings_rank: 14, ast_to_wings_allowed: 4.1, ast_to_bigs_rank: 14, ast_to_bigs_allowed: 3.6
  },
  { 
    team_name: 'Dallas Mavericks', team_abbrev: 'DAL', 
    points_rank: 14, points_allowed: 112.1, rebounds_rank: 16, rebounds_allowed: 45.8, assists_rank: 13, assists_allowed: 25.3, threes_rank: 13, threes_allowed: 13.4,
    pts_to_guards_rank: 13, pts_to_guards_allowed: 21.5, pts_to_wings_rank: 14, pts_to_wings_allowed: 19.0, pts_to_bigs_rank: 15, pts_to_bigs_allowed: 24.8,
    reb_to_guards_rank: 16, reb_to_guards_allowed: 3.8, reb_to_wings_rank: 16, reb_to_wings_allowed: 6.5, reb_to_bigs_rank: 16, reb_to_bigs_allowed: 11.2,
    ast_to_guards_rank: 13, ast_to_guards_allowed: 7.1, ast_to_wings_rank: 15, ast_to_wings_allowed: 4.2, ast_to_bigs_rank: 15, ast_to_bigs_allowed: 3.7
  },
  { 
    team_name: 'Phoenix Suns', team_abbrev: 'PHX', 
    points_rank: 15, points_allowed: 112.5, rebounds_rank: 15, rebounds_allowed: 45.5, assists_rank: 16, assists_allowed: 25.8, threes_rank: 16, threes_allowed: 13.8,
    pts_to_guards_rank: 15, pts_to_guards_allowed: 22.0, pts_to_wings_rank: 15, pts_to_wings_allowed: 19.2, pts_to_bigs_rank: 16, pts_to_bigs_allowed: 25.0,
    reb_to_guards_rank: 15, reb_to_guards_allowed: 3.7, reb_to_wings_rank: 15, reb_to_wings_allowed: 6.4, reb_to_bigs_rank: 15, reb_to_bigs_allowed: 11.1,
    ast_to_guards_rank: 16, ast_to_guards_allowed: 7.4, ast_to_wings_rank: 16, ast_to_wings_allowed: 4.3, ast_to_bigs_rank: 16, ast_to_bigs_allowed: 3.8
  },
  { 
    team_name: 'Indiana Pacers', team_abbrev: 'IND', 
    points_rank: 16, points_allowed: 113.0, rebounds_rank: 18, rebounds_allowed: 46.2, assists_rank: 15, assists_allowed: 25.6, threes_rank: 15, threes_allowed: 13.6,
    pts_to_guards_rank: 16, pts_to_guards_allowed: 22.2, pts_to_wings_rank: 16, pts_to_wings_allowed: 19.5, pts_to_bigs_rank: 17, pts_to_bigs_allowed: 25.2,
    reb_to_guards_rank: 18, reb_to_guards_allowed: 4.0, reb_to_wings_rank: 18, reb_to_wings_allowed: 6.8, reb_to_bigs_rank: 18, reb_to_bigs_allowed: 11.5,
    ast_to_guards_rank: 15, ast_to_guards_allowed: 7.3, ast_to_wings_rank: 17, ast_to_wings_allowed: 4.4, ast_to_bigs_rank: 17, ast_to_bigs_allowed: 3.9
  },
  { 
    team_name: 'Los Angeles Clippers', team_abbrev: 'LAC', 
    points_rank: 17, points_allowed: 113.5, rebounds_rank: 13, rebounds_allowed: 45.0, assists_rank: 18, assists_allowed: 26.1, threes_rank: 18, threes_allowed: 14.0,
    pts_to_guards_rank: 17, pts_to_guards_allowed: 22.5, pts_to_wings_rank: 17, pts_to_wings_allowed: 19.8, pts_to_bigs_rank: 18, pts_to_bigs_allowed: 25.5,
    reb_to_guards_rank: 13, reb_to_guards_allowed: 3.5, reb_to_wings_rank: 13, reb_to_wings_allowed: 6.1, reb_to_bigs_rank: 13, reb_to_bigs_allowed: 10.9,
    ast_to_guards_rank: 18, ast_to_guards_allowed: 7.6, ast_to_wings_rank: 18, ast_to_wings_allowed: 4.5, ast_to_bigs_rank: 18, ast_to_bigs_allowed: 4.0
  },
  { 
    team_name: 'Philadelphia 76ers', team_abbrev: 'PHI', 
    points_rank: 18, points_allowed: 113.8, rebounds_rank: 17, rebounds_allowed: 46.0, assists_rank: 17, assists_allowed: 26.0, threes_rank: 17, threes_allowed: 13.9,
    pts_to_guards_rank: 18, pts_to_guards_allowed: 22.8, pts_to_wings_rank: 18, pts_to_wings_allowed: 20.0, pts_to_bigs_rank: 19, pts_to_bigs_allowed: 25.8,
    reb_to_guards_rank: 17, reb_to_guards_allowed: 3.9, reb_to_wings_rank: 17, reb_to_wings_allowed: 6.6, reb_to_bigs_rank: 17, reb_to_bigs_allowed: 11.4,
    ast_to_guards_rank: 17, ast_to_guards_allowed: 7.5, ast_to_wings_rank: 19, ast_to_wings_allowed: 4.6, ast_to_bigs_rank: 19, ast_to_bigs_allowed: 4.1
  },
  { 
    team_name: 'Chicago Bulls', team_abbrev: 'CHI', 
    points_rank: 19, points_allowed: 114.2, rebounds_rank: 20, rebounds_allowed: 46.8, assists_rank: 19, assists_allowed: 26.3, threes_rank: 19, threes_allowed: 14.1,
    pts_to_guards_rank: 19, pts_to_guards_allowed: 23.0, pts_to_wings_rank: 19, pts_to_wings_allowed: 20.2, pts_to_bigs_rank: 20, pts_to_bigs_allowed: 26.0,
    reb_to_guards_rank: 20, reb_to_guards_allowed: 4.2, reb_to_wings_rank: 20, reb_to_wings_allowed: 7.0, reb_to_bigs_rank: 20, reb_to_bigs_allowed: 11.8,
    ast_to_guards_rank: 19, ast_to_guards_allowed: 7.8, ast_to_wings_rank: 20, ast_to_wings_allowed: 4.7, ast_to_bigs_rank: 20, ast_to_bigs_allowed: 4.2
  },
  { 
    team_name: 'Toronto Raptors', team_abbrev: 'TOR', 
    points_rank: 20, points_allowed: 114.8, rebounds_rank: 19, rebounds_allowed: 46.5, assists_rank: 20, assists_allowed: 26.5, threes_rank: 20, threes_allowed: 14.3,
    pts_to_guards_rank: 20, pts_to_guards_allowed: 23.2, pts_to_wings_rank: 20, pts_to_wings_allowed: 20.5, pts_to_bigs_rank: 21, pts_to_bigs_allowed: 26.2,
    reb_to_guards_rank: 19, reb_to_guards_allowed: 4.1, reb_to_wings_rank: 19, reb_to_wings_allowed: 6.9, reb_to_bigs_rank: 19, reb_to_bigs_allowed: 11.6,
    ast_to_guards_rank: 20, ast_to_guards_allowed: 7.9, ast_to_wings_rank: 21, ast_to_wings_allowed: 4.8, ast_to_bigs_rank: 21, ast_to_bigs_allowed: 4.3
  },
  { 
    team_name: 'Brooklyn Nets', team_abbrev: 'BKN', 
    points_rank: 21, points_allowed: 115.2, rebounds_rank: 22, rebounds_allowed: 47.2, assists_rank: 21, assists_allowed: 26.8, threes_rank: 21, threes_allowed: 14.5,
    pts_to_guards_rank: 21, pts_to_guards_allowed: 23.5, pts_to_wings_rank: 21, pts_to_wings_allowed: 20.8, pts_to_bigs_rank: 22, pts_to_bigs_allowed: 26.5,
    reb_to_guards_rank: 22, reb_to_guards_allowed: 4.4, reb_to_wings_rank: 22, reb_to_wings_allowed: 7.2, reb_to_bigs_rank: 22, reb_to_bigs_allowed: 12.0,
    ast_to_guards_rank: 21, ast_to_guards_allowed: 8.0, ast_to_wings_rank: 22, ast_to_wings_allowed: 4.9, ast_to_bigs_rank: 22, ast_to_bigs_allowed: 4.4
  },
  { 
    team_name: 'New Orleans Pelicans', team_abbrev: 'NOP', 
    points_rank: 22, points_allowed: 115.8, rebounds_rank: 21, rebounds_allowed: 47.0, assists_rank: 22, assists_allowed: 27.0, threes_rank: 23, threes_allowed: 14.8,
    pts_to_guards_rank: 22, pts_to_guards_allowed: 23.8, pts_to_wings_rank: 22, pts_to_wings_allowed: 21.0, pts_to_bigs_rank: 23, pts_to_bigs_allowed: 26.8,
    reb_to_guards_rank: 21, reb_to_guards_allowed: 4.3, reb_to_wings_rank: 21, reb_to_wings_allowed: 7.1, reb_to_bigs_rank: 21, reb_to_bigs_allowed: 11.9,
    ast_to_guards_rank: 22, ast_to_guards_allowed: 8.1, ast_to_wings_rank: 23, ast_to_wings_allowed: 5.0, ast_to_bigs_rank: 23, ast_to_bigs_allowed: 4.5
  },
  { 
    team_name: 'San Antonio Spurs', team_abbrev: 'SAS', 
    points_rank: 23, points_allowed: 116.2, rebounds_rank: 24, rebounds_allowed: 47.8, assists_rank: 24, assists_allowed: 27.3, threes_rank: 22, threes_allowed: 14.6,
    pts_to_guards_rank: 23, pts_to_guards_allowed: 24.0, pts_to_wings_rank: 23, pts_to_wings_allowed: 21.2, pts_to_bigs_rank: 24, pts_to_bigs_allowed: 27.0,
    reb_to_guards_rank: 24, reb_to_guards_allowed: 4.6, reb_to_wings_rank: 24, reb_to_wings_allowed: 7.4, reb_to_bigs_rank: 24, reb_to_bigs_allowed: 12.2,
    ast_to_guards_rank: 24, ast_to_guards_allowed: 8.3, ast_to_wings_rank: 24, ast_to_wings_allowed: 5.1, ast_to_bigs_rank: 24, ast_to_bigs_allowed: 4.6
  },
  { 
    team_name: 'Charlotte Hornets', team_abbrev: 'CHA', 
    points_rank: 24, points_allowed: 116.8, rebounds_rank: 23, rebounds_allowed: 47.5, assists_rank: 23, assists_allowed: 27.2, threes_rank: 24, threes_allowed: 15.0,
    pts_to_guards_rank: 24, pts_to_guards_allowed: 24.2, pts_to_wings_rank: 24, pts_to_wings_allowed: 21.5, pts_to_bigs_rank: 25, pts_to_bigs_allowed: 27.2,
    reb_to_guards_rank: 23, reb_to_guards_allowed: 4.5, reb_to_wings_rank: 23, reb_to_wings_allowed: 7.3, reb_to_bigs_rank: 23, reb_to_bigs_allowed: 12.1,
    ast_to_guards_rank: 23, ast_to_guards_allowed: 8.2, ast_to_wings_rank: 25, ast_to_wings_allowed: 5.2, ast_to_bigs_rank: 25, ast_to_bigs_allowed: 4.7
  },
  { 
    team_name: 'Portland Trail Blazers', team_abbrev: 'POR', 
    points_rank: 25, points_allowed: 117.2, rebounds_rank: 25, rebounds_allowed: 48.0, assists_rank: 26, assists_allowed: 27.8, threes_rank: 26, threes_allowed: 15.3,
    pts_to_guards_rank: 25, pts_to_guards_allowed: 24.5, pts_to_wings_rank: 25, pts_to_wings_allowed: 21.8, pts_to_bigs_rank: 26, pts_to_bigs_allowed: 27.5,
    reb_to_guards_rank: 25, reb_to_guards_allowed: 4.7, reb_to_wings_rank: 25, reb_to_wings_allowed: 7.5, reb_to_bigs_rank: 25, reb_to_bigs_allowed: 12.4,
    ast_to_guards_rank: 26, ast_to_guards_allowed: 8.5, ast_to_wings_rank: 26, ast_to_wings_allowed: 5.3, ast_to_bigs_rank: 26, ast_to_bigs_allowed: 4.8
  },
  { 
    team_name: 'Detroit Pistons', team_abbrev: 'DET', 
    points_rank: 26, points_allowed: 117.8, rebounds_rank: 27, rebounds_allowed: 48.5, assists_rank: 25, assists_allowed: 27.5, threes_rank: 25, threes_allowed: 15.1,
    pts_to_guards_rank: 26, pts_to_guards_allowed: 24.8, pts_to_wings_rank: 26, pts_to_wings_allowed: 22.0, pts_to_bigs_rank: 27, pts_to_bigs_allowed: 27.8,
    reb_to_guards_rank: 27, reb_to_guards_allowed: 4.9, reb_to_wings_rank: 27, reb_to_wings_allowed: 7.7, reb_to_bigs_rank: 27, reb_to_bigs_allowed: 12.6,
    ast_to_guards_rank: 25, ast_to_guards_allowed: 8.4, ast_to_wings_rank: 27, ast_to_wings_allowed: 5.4, ast_to_bigs_rank: 27, ast_to_bigs_allowed: 4.9
  },
  { 
    team_name: 'Atlanta Hawks', team_abbrev: 'ATL', 
    points_rank: 27, points_allowed: 118.2, rebounds_rank: 26, rebounds_allowed: 48.2, assists_rank: 27, assists_allowed: 28.0, threes_rank: 27, threes_allowed: 15.5,
    pts_to_guards_rank: 27, pts_to_guards_allowed: 25.0, pts_to_wings_rank: 27, pts_to_wings_allowed: 22.2, pts_to_bigs_rank: 28, pts_to_bigs_allowed: 28.0,
    reb_to_guards_rank: 26, reb_to_guards_allowed: 4.8, reb_to_wings_rank: 26, reb_to_wings_allowed: 7.6, reb_to_bigs_rank: 26, reb_to_bigs_allowed: 12.5,
    ast_to_guards_rank: 27, ast_to_guards_allowed: 8.6, ast_to_wings_rank: 28, ast_to_wings_allowed: 5.5, ast_to_bigs_rank: 28, ast_to_bigs_allowed: 5.0
  },
  { 
    team_name: 'Sacramento Kings', team_abbrev: 'SAC', 
    points_rank: 28, points_allowed: 118.8, rebounds_rank: 28, rebounds_allowed: 48.8, assists_rank: 28, assists_allowed: 28.3, threes_rank: 28, threes_allowed: 15.8,
    pts_to_guards_rank: 28, pts_to_guards_allowed: 25.2, pts_to_wings_rank: 28, pts_to_wings_allowed: 22.5, pts_to_bigs_rank: 29, pts_to_bigs_allowed: 28.2,
    reb_to_guards_rank: 28, reb_to_guards_allowed: 5.0, reb_to_wings_rank: 28, reb_to_wings_allowed: 7.8, reb_to_bigs_rank: 28, reb_to_bigs_allowed: 12.8,
    ast_to_guards_rank: 28, ast_to_guards_allowed: 8.8, ast_to_wings_rank: 29, ast_to_wings_allowed: 5.6, ast_to_bigs_rank: 29, ast_to_bigs_allowed: 5.1
  },
  { 
    team_name: 'Utah Jazz', team_abbrev: 'UTA', 
    points_rank: 29, points_allowed: 119.2, rebounds_rank: 29, rebounds_allowed: 49.2, assists_rank: 29, assists_allowed: 28.5, threes_rank: 29, threes_allowed: 16.0,
    pts_to_guards_rank: 29, pts_to_guards_allowed: 25.5, pts_to_wings_rank: 29, pts_to_wings_allowed: 22.8, pts_to_bigs_rank: 30, pts_to_bigs_allowed: 28.5,
    reb_to_guards_rank: 29, reb_to_guards_allowed: 5.1, reb_to_wings_rank: 29, reb_to_wings_allowed: 8.0, reb_to_bigs_rank: 29, reb_to_bigs_allowed: 13.0,
    ast_to_guards_rank: 29, ast_to_guards_allowed: 9.0, ast_to_wings_rank: 30, ast_to_wings_allowed: 5.8, ast_to_bigs_rank: 30, ast_to_bigs_allowed: 5.2
  },
  { 
    team_name: 'Washington Wizards', team_abbrev: 'WAS', 
    points_rank: 30, points_allowed: 120.5, rebounds_rank: 30, rebounds_allowed: 50.0, assists_rank: 30, assists_allowed: 29.0, threes_rank: 30, threes_allowed: 16.5,
    pts_to_guards_rank: 30, pts_to_guards_allowed: 26.0, pts_to_wings_rank: 30, pts_to_wings_allowed: 23.2, pts_to_bigs_rank: 1, pts_to_bigs_allowed: 20.5, // Wizards actually good at defending bigs
    reb_to_guards_rank: 30, reb_to_guards_allowed: 5.2, reb_to_wings_rank: 30, reb_to_wings_allowed: 8.2, reb_to_bigs_rank: 30, reb_to_bigs_allowed: 13.2,
    ast_to_guards_rank: 30, ast_to_guards_allowed: 9.2, ast_to_wings_rank: 1, ast_to_wings_allowed: 2.8, ast_to_bigs_rank: 1, ast_to_bigs_allowed: 2.3
  },
];

// Helper to get position-specific defense
function getPositionDefense(
  team: TeamDefenseRating,
  statType: string,
  positionGroup: PositionGroup
): { rank: number; allowed: number } {
  const stat = statType.toLowerCase();
  
  if (positionGroup === 'all') {
    if (stat.includes('point')) return { rank: team.points_rank, allowed: team.points_allowed };
    if (stat.includes('rebound')) return { rank: team.rebounds_rank, allowed: team.rebounds_allowed };
    if (stat.includes('assist')) return { rank: team.assists_rank, allowed: team.assists_allowed };
    if (stat.includes('three')) return { rank: team.threes_rank, allowed: team.threes_allowed };
    return { rank: 15, allowed: 0 }; // Default middle of pack
  }
  
  if (stat.includes('point')) {
    if (positionGroup === 'guards') return { rank: team.pts_to_guards_rank, allowed: team.pts_to_guards_allowed };
    if (positionGroup === 'wings') return { rank: team.pts_to_wings_rank, allowed: team.pts_to_wings_allowed };
    if (positionGroup === 'bigs') return { rank: team.pts_to_bigs_rank, allowed: team.pts_to_bigs_allowed };
  }
  
  if (stat.includes('rebound')) {
    if (positionGroup === 'guards') return { rank: team.reb_to_guards_rank, allowed: team.reb_to_guards_allowed };
    if (positionGroup === 'wings') return { rank: team.reb_to_wings_rank, allowed: team.reb_to_wings_allowed };
    if (positionGroup === 'bigs') return { rank: team.reb_to_bigs_rank, allowed: team.reb_to_bigs_allowed };
  }
  
  if (stat.includes('assist')) {
    if (positionGroup === 'guards') return { rank: team.ast_to_guards_rank, allowed: team.ast_to_guards_allowed };
    if (positionGroup === 'wings') return { rank: team.ast_to_wings_rank, allowed: team.ast_to_wings_allowed };
    if (positionGroup === 'bigs') return { rank: team.ast_to_bigs_rank, allowed: team.ast_to_bigs_allowed };
  }
  
  // Fallback to overall
  if (stat.includes('point')) return { rank: team.points_rank, allowed: team.points_allowed };
  if (stat.includes('rebound')) return { rank: team.rebounds_rank, allowed: team.rebounds_allowed };
  if (stat.includes('assist')) return { rank: team.assists_rank, allowed: team.assists_allowed };
  
  return { rank: 15, allowed: 0 };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const { action, team, statType, positionGroup } = await req.json().catch(() => ({ action: 'refresh' }));
    
    if (action === 'refresh' || action === 'update') {
      console.log('[Defense Ratings] Refreshing team defensive ratings with position-specific data...');
      
      const records: Array<{
        team_name: string;
        team_abbrev: string;
        stat_type: string;
        position_group: string;
        defensive_rank: number;
        stat_allowed_per_game: number;
        vs_guards_rank: number | null;
        vs_guards_allowed: number | null;
        vs_wings_rank: number | null;
        vs_wings_allowed: number | null;
        vs_bigs_rank: number | null;
        vs_bigs_allowed: number | null;
        games_sample: number;
        season: string;
        updated_at: string;
      }> = [];
      
      const now = new Date().toISOString();
      const positionGroups: PositionGroup[] = ['all', 'guards', 'wings', 'bigs'];
      const statTypes = ['points', 'rebounds', 'assists', 'threes'];
      
      for (const teamData of NBA_DEFENSE_RATINGS) {
        for (const stat of statTypes) {
          for (const pos of positionGroups) {
            const defense = getPositionDefense(teamData, stat, pos);
            
            // Get position-specific data for the "all" record
            const guardsDefense = getPositionDefense(teamData, stat, 'guards');
            const wingsDefense = getPositionDefense(teamData, stat, 'wings');
            const bigsDefense = getPositionDefense(teamData, stat, 'bigs');
            
            records.push({
              team_name: teamData.team_name,
              team_abbrev: teamData.team_abbrev,
              stat_type: stat,
              position_group: pos,
              defensive_rank: defense.rank,
              stat_allowed_per_game: defense.allowed,
              vs_guards_rank: pos === 'all' ? guardsDefense.rank : null,
              vs_guards_allowed: pos === 'all' ? guardsDefense.allowed : null,
              vs_wings_rank: pos === 'all' ? wingsDefense.rank : null,
              vs_wings_allowed: pos === 'all' ? wingsDefense.allowed : null,
              vs_bigs_rank: pos === 'all' ? bigsDefense.rank : null,
              vs_bigs_allowed: pos === 'all' ? bigsDefense.allowed : null,
              games_sample: 40,
              season: '2024-25',
              updated_at: now,
            });
          }
        }
      }
      
      // Upsert all records into team_defensive_ratings (position-specific, used by matchup-intelligence)
      const { error: upsertError } = await supabase
        .from('team_defensive_ratings')
        .upsert(records, { 
          onConflict: 'team_name,stat_type,position_group,season',
        });
      
      if (upsertError) {
        throw upsertError;
      }
      
      // === CRITICAL: Also upsert into nba_opponent_defense_stats ===
      // bot-generate-daily-parlays reads from THIS table for composite score adjustments.
      // Map each team's overall (position_group='all') stat rows into nba_opponent_defense_stats format.
      const defenseStatsNow = new Date().toISOString();
      const nbaDefenseStatRecords: Array<{
        team_name: string;
        stat_category: string;
        defense_rank: number;
        defense_rating: number;
        updated_at: string;
      }> = [];
      
      for (const teamData of NBA_DEFENSE_RATINGS) {
        // One row per stat category (overall only — used by buildPropPool defense filter)
        nbaDefenseStatRecords.push({
          team_name: teamData.team_name,
          stat_category: 'points',
          defense_rank: teamData.points_rank,
          defense_rating: teamData.points_allowed,
          updated_at: defenseStatsNow,
        });
        nbaDefenseStatRecords.push({
          team_name: teamData.team_name,
          stat_category: 'rebounds',
          defense_rank: teamData.rebounds_rank,
          defense_rating: teamData.rebounds_allowed,
          updated_at: defenseStatsNow,
        });
        nbaDefenseStatRecords.push({
          team_name: teamData.team_name,
          stat_category: 'assists',
          defense_rank: teamData.assists_rank,
          defense_rating: teamData.assists_allowed,
          updated_at: defenseStatsNow,
        });
        nbaDefenseStatRecords.push({
          team_name: teamData.team_name,
          stat_category: 'threes',
          defense_rank: teamData.threes_rank,
          defense_rating: teamData.threes_allowed,
          updated_at: defenseStatsNow,
        });
        // Overall composite rank (average of the four)
        const overallRank = Math.round(
          (teamData.points_rank + teamData.rebounds_rank + teamData.assists_rank + teamData.threes_rank) / 4
        );
        nbaDefenseStatRecords.push({
          team_name: teamData.team_name,
          stat_category: 'overall',
          defense_rank: overallRank,
          defense_rating: teamData.points_allowed,
          updated_at: defenseStatsNow,
        });
      }
      
      const { error: nbaDefStatsError } = await supabase
        .from('nba_opponent_defense_stats')
        .upsert(nbaDefenseStatRecords, {
          onConflict: 'team_name,stat_category',
        });
      
      if (nbaDefStatsError) {
        console.error('[Defense Ratings] Failed to upsert nba_opponent_defense_stats:', nbaDefStatsError);
      } else {
        console.log(`[Defense Ratings] Also updated ${nbaDefenseStatRecords.length} rows in nba_opponent_defense_stats`);
      }
      
      console.log(`[Defense Ratings] Updated ${records.length} defensive rating records (position-specific)`);
      
      return new Response(JSON.stringify({
        success: true,
        updated: records.length,
        nba_defense_stats_updated: nbaDefenseStatRecords.length,
        teams: NBA_DEFENSE_RATINGS.length,
        positionGroups: positionGroups.length,
        statTypes: statTypes.length,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    
    // Action: get - Get defensive ratings for a specific team
    if (action === 'get') {
      let query = supabase
        .from('team_defensive_ratings')
        .select('*')
        .ilike('team_name', `%${team}%`);
      
      if (statType) {
        query = query.eq('stat_type', statType.toLowerCase());
      }
      if (positionGroup) {
        query = query.eq('position_group', positionGroup.toLowerCase());
      }
      
      const { data } = await query;
      
      return new Response(JSON.stringify({
        success: true,
        ratings: data || [],
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    
    // Action: get_position_matchup - Get position-specific matchup data
    if (action === 'get_position_matchup') {
      const { data } = await supabase
        .from('team_defensive_ratings')
        .select('*')
        .ilike('team_name', `%${team}%`)
        .eq('stat_type', statType?.toLowerCase() || 'points')
        .eq('position_group', positionGroup?.toLowerCase() || 'all')
        .maybeSingle();
      
      return new Response(JSON.stringify({
        success: true,
        matchup: data,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    
    // Action: get_all - Get all defensive ratings
    if (action === 'get_all') {
      const { data } = await supabase
        .from('team_defensive_ratings')
        .select('*')
        .order('defensive_rank', { ascending: true });
      
      return new Response(JSON.stringify({
        success: true,
        ratings: data || [],
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    
    return new Response(JSON.stringify({ 
      success: true,
      message: 'Use action: refresh, get, get_position_matchup, or get_all' 
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
    
  } catch (error) {
    console.error('[Defense Ratings] Error:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
