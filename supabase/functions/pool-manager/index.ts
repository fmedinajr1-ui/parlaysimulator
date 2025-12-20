import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'No authorization header' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const { data: { user }, error: authError } = await supabaseClient.auth.getUser(
      authHeader.replace('Bearer ', '')
    );

    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Invalid token' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const { action, ...params } = await req.json();
    console.log(`Pool manager action: ${action}`, { userId: user.id, params });

    switch (action) {
      case 'create': {
        const { pool_name, num_legs_required, pool_rules, stake_per_member } = params;

        // Create the pool
        const { data: pool, error: poolError } = await supabaseClient
          .from('parlay_pools')
          .insert({
            creator_id: user.id,
            pool_name,
            num_legs_required,
            pool_rules: pool_rules || {},
            stake_per_member: stake_per_member || 10
          })
          .select()
          .single();

        if (poolError) {
          console.error('Error creating pool:', poolError);
          return new Response(JSON.stringify({ error: poolError.message }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        // Add creator as a member
        const { error: memberError } = await supabaseClient
          .from('pool_memberships')
          .insert({
            pool_id: pool.id,
            user_id: user.id,
            role: 'creator'
          });

        if (memberError) {
          console.error('Error adding creator as member:', memberError);
        }

        // Update leaderboard stats
        await updateLeaderboardStats(supabaseClient, user.id, 'pools_joined');

        console.log('Pool created successfully:', pool.id);
        return new Response(JSON.stringify({ 
          success: true, 
          pool,
          invite_url: `/pools/join/${pool.invite_code}`
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      case 'join': {
        const { invite_code } = params;

        // Find pool by invite code
        const { data: pool, error: findError } = await supabaseClient
          .from('parlay_pools')
          .select('*')
          .eq('invite_code', invite_code)
          .single();

        if (findError || !pool) {
          return new Response(JSON.stringify({ error: 'Pool not found' }), {
            status: 404,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        if (pool.status !== 'open') {
          return new Response(JSON.stringify({ error: 'Pool is no longer accepting members' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        // Check if already a member
        const { data: existingMember } = await supabaseClient
          .from('pool_memberships')
          .select('id')
          .eq('pool_id', pool.id)
          .eq('user_id', user.id)
          .single();

        if (existingMember) {
          return new Response(JSON.stringify({ 
            success: true, 
            pool,
            already_member: true 
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        // Check if pool is full
        const { count } = await supabaseClient
          .from('pool_memberships')
          .select('*', { count: 'exact', head: true })
          .eq('pool_id', pool.id);

        if (count && count >= pool.num_legs_required) {
          return new Response(JSON.stringify({ error: 'Pool is full' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        // Add member
        const { error: joinError } = await supabaseClient
          .from('pool_memberships')
          .insert({
            pool_id: pool.id,
            user_id: user.id,
            role: 'member'
          });

        if (joinError) {
          console.error('Error joining pool:', joinError);
          return new Response(JSON.stringify({ error: joinError.message }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        // Update leaderboard stats
        await updateLeaderboardStats(supabaseClient, user.id, 'pools_joined');

        console.log('User joined pool:', { userId: user.id, poolId: pool.id });
        return new Response(JSON.stringify({ success: true, pool }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      case 'submit-leg': {
        const { pool_id, description, odds, bet_type, sport, event_id, player_name, prop_type, line, side, implied_probability, engine_source, engine_confidence } = params;

        // Verify pool exists and is open
        const { data: pool, error: poolError } = await supabaseClient
          .from('parlay_pools')
          .select('*')
          .eq('id', pool_id)
          .single();

        if (poolError || !pool) {
          return new Response(JSON.stringify({ error: 'Pool not found' }), {
            status: 404,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        if (pool.status !== 'open') {
          return new Response(JSON.stringify({ error: 'Pool is locked' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        // Verify user is a member
        const { data: membership } = await supabaseClient
          .from('pool_memberships')
          .select('id')
          .eq('pool_id', pool_id)
          .eq('user_id', user.id)
          .single();

        if (!membership) {
          return new Response(JSON.stringify({ error: 'You are not a member of this pool' }), {
            status: 403,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        // Check if user already submitted a leg
        const { data: existingLeg } = await supabaseClient
          .from('pool_legs')
          .select('id')
          .eq('pool_id', pool_id)
          .eq('user_id', user.id)
          .single();

        if (existingLeg) {
          return new Response(JSON.stringify({ error: 'You have already submitted a leg to this pool' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        // Get next leg index
        const { count: legCount } = await supabaseClient
          .from('pool_legs')
          .select('*', { count: 'exact', head: true })
          .eq('pool_id', pool_id);

        const legIndex = (legCount || 0) + 1;

        // Insert leg
        const { data: leg, error: legError } = await supabaseClient
          .from('pool_legs')
          .insert({
            pool_id,
            user_id: user.id,
            leg_index: legIndex,
            description,
            odds,
            bet_type,
            sport,
            event_id,
            player_name,
            prop_type,
            line,
            side,
            implied_probability,
            engine_source,
            engine_confidence
          })
          .select()
          .single();

        if (legError) {
          console.error('Error submitting leg:', legError);
          return new Response(JSON.stringify({ error: legError.message }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        // Update combined odds
        const { data: allLegs } = await supabaseClient
          .from('pool_legs')
          .select('odds')
          .eq('pool_id', pool_id);

        if (allLegs && allLegs.length > 0) {
          const combinedOdds = calculateCombinedOdds(allLegs.map(l => l.odds));
          await supabaseClient
            .from('parlay_pools')
            .update({ combined_odds: combinedOdds })
            .eq('id', pool_id);
        }

        // Update leaderboard stats
        await updateLeaderboardStats(supabaseClient, user.id, 'legs_submitted');

        // Check if pool is now full and should be locked
        if (legIndex >= pool.num_legs_required) {
          await supabaseClient
            .from('parlay_pools')
            .update({ status: 'in_progress' })
            .eq('id', pool_id);
          console.log('Pool locked - all legs submitted:', pool_id);
        }

        console.log('Leg submitted:', { legId: leg.id, poolId: pool_id, legIndex });
        return new Response(JSON.stringify({ 
          success: true, 
          leg,
          pool_locked: legIndex >= pool.num_legs_required
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      case 'get-pool': {
        const { pool_id, invite_code } = params;

        let query = supabaseClient.from('parlay_pools').select('*');
        
        if (pool_id) {
          query = query.eq('id', pool_id);
        } else if (invite_code) {
          query = query.eq('invite_code', invite_code);
        } else {
          return new Response(JSON.stringify({ error: 'pool_id or invite_code required' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const { data: pool, error } = await query.single();

        if (error || !pool) {
          return new Response(JSON.stringify({ error: 'Pool not found' }), {
            status: 404,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        // Get members with profile info
        const { data: memberships } = await supabaseClient
          .from('pool_memberships')
          .select('user_id, role, joined_at')
          .eq('pool_id', pool.id);

        // Get profile info for members
        const memberIds = memberships?.map(m => m.user_id) || [];
        const { data: profiles } = await supabaseClient
          .from('profiles')
          .select('user_id, username, avatar_url')
          .in('user_id', memberIds);

        const membersWithProfiles = memberships?.map(m => ({
          ...m,
          profiles: profiles?.find(p => p.user_id === m.user_id) || null
        })) || [];

        // Get legs with profile info
        const { data: legs } = await supabaseClient
          .from('pool_legs')
          .select('*')
          .eq('pool_id', pool.id)
          .order('leg_index', { ascending: true });

        const legUserIds = legs?.map(l => l.user_id) || [];
        const { data: legProfiles } = await supabaseClient
          .from('profiles')
          .select('user_id, username, avatar_url')
          .in('user_id', legUserIds);

        const legsWithProfiles = legs?.map(l => ({
          ...l,
          profiles: legProfiles?.find(p => p.user_id === l.user_id) || null
        })) || [];

        // Check if current user is a member
        const isMember = memberships?.some(m => m.user_id === user.id);

        return new Response(JSON.stringify({ 
          success: true, 
          pool,
          members: membersWithProfiles,
          legs: legsWithProfiles,
          is_member: isMember
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      case 'list-pools': {
        const { status, user_only } = params;

        let query = supabaseClient.from('parlay_pools').select('*');

        if (status) {
          query = query.eq('status', status);
        }

        if (user_only) {
          // Get pools where user is a member
          const { data: memberships } = await supabaseClient
            .from('pool_memberships')
            .select('pool_id')
            .eq('user_id', user.id);

          const poolIds = memberships?.map(m => m.pool_id) || [];
          
          if (poolIds.length === 0) {
            return new Response(JSON.stringify({ success: true, pools: [] }), {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          }

          query = query.in('id', poolIds);
        }

        query = query.order('created_at', { ascending: false }).limit(50);

        const { data: pools, error } = await query;

        if (error) {
          return new Response(JSON.stringify({ error: error.message }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        // Get member counts and creator info for each pool
        const poolsWithCounts = await Promise.all((pools || []).map(async (pool) => {
          const { count } = await supabaseClient
            .from('pool_memberships')
            .select('*', { count: 'exact', head: true })
            .eq('pool_id', pool.id);

          const { count: legCount } = await supabaseClient
            .from('pool_legs')
            .select('*', { count: 'exact', head: true })
            .eq('pool_id', pool.id);

          // Get creator profile
          const { data: creatorProfile } = await supabaseClient
            .from('profiles')
            .select('username, avatar_url')
            .eq('user_id', pool.creator_id)
            .single();

          return {
            ...pool,
            member_count: count || 0,
            legs_submitted: legCount || 0,
            creator_username: creatorProfile?.username || null,
            creator_avatar: creatorProfile?.avatar_url || null
          };
        }));

        return new Response(JSON.stringify({ success: true, pools: poolsWithCounts }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      case 'get-leaderboard': {
        const { data: leaderboard, error } = await supabaseClient
          .from('pool_leaderboard_stats')
          .select('*')
          .order('roi_percentage', { ascending: false })
          .limit(50);

        if (error) {
          return new Response(JSON.stringify({ error: error.message }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        // Get profile info for leaderboard entries
        const userIds = leaderboard?.map(l => l.user_id) || [];
        const { data: profiles } = await supabaseClient
          .from('profiles')
          .select('user_id, username, avatar_url')
          .in('user_id', userIds);

        const leaderboardWithProfiles = leaderboard?.map(entry => ({
          ...entry,
          profiles: profiles?.find(p => p.user_id === entry.user_id) || null
        })) || [];

        return new Response(JSON.stringify({ success: true, leaderboard: leaderboardWithProfiles }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      default:
        return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
    }
  } catch (error: unknown) {
    console.error('Pool manager error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

function calculateCombinedOdds(oddsList: number[]): number {
  // Convert American odds to decimal, multiply, convert back
  const decimalOdds = oddsList.map(odds => {
    if (odds > 0) {
      return (odds / 100) + 1;
    } else {
      return (100 / Math.abs(odds)) + 1;
    }
  });

  const combinedDecimal = decimalOdds.reduce((acc, curr) => acc * curr, 1);

  // Convert back to American
  if (combinedDecimal >= 2) {
    return Math.round((combinedDecimal - 1) * 100);
  } else {
    return Math.round(-100 / (combinedDecimal - 1));
  }
}

async function updateLeaderboardStats(supabase: any, userId: string, stat: string) {
  try {
    // Check if stats exist
    const { data: existing } = await supabase
      .from('pool_leaderboard_stats')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (existing) {
      const updates: any = { updated_at: new Date().toISOString() };
      
      if (stat === 'pools_joined') {
        updates.total_pools_joined = (existing.total_pools_joined || 0) + 1;
      } else if (stat === 'legs_submitted') {
        updates.legs_submitted = (existing.legs_submitted || 0) + 1;
      }

      await supabase
        .from('pool_leaderboard_stats')
        .update(updates)
        .eq('user_id', userId);
    } else {
      const newStats: any = {
        user_id: userId,
        total_pools_joined: stat === 'pools_joined' ? 1 : 0,
        legs_submitted: stat === 'legs_submitted' ? 1 : 0
      };

      await supabase
        .from('pool_leaderboard_stats')
        .insert(newStats);
    }
  } catch (error) {
    console.error('Error updating leaderboard stats:', error);
  }
}
