import { computeEdges, rosterResolver, juice, type RawLine } from "./deskEdges.ts";
import { MODEL_VERSION } from "./nbaProjection.ts";
import { pickWarnings } from "./pickWarnings.ts";
import { skepticalHistory, verifiedSkepticalMarket } from "./skeptical.ts";
import { syncBotFromShelf } from "./botSync.ts";
import type { GameLog } from "./math.ts";

/** One daily pregame pool: exactly the desk's model, roster normalization and main-line selection. */
export async function snapshotDeskBots(sb: any, today: string, events: any[]) {
  const [{data: roster, error: re}, {data: rawLines, error: le}, {data: injuries, error: ie}] = await Promise.all([
    sb.from("research_player_teams").select("player_name,team,position").limit(2000),
    sb.from("research_prop_lines").select("player_name,stat,line,book,event_label,over_price,under_price").eq("game_date",today).limit(10000),
    sb.from("nba_injury_reports").select("player_name,status").eq("game_date",today).limit(1000),
  ]);
  if (re || le || ie) throw re ?? le ?? ie;
  const resolve = rosterResolver((roster ?? []).map((r:any)=>r.player_name));
  const byPlayer = new Map<string,GameLog[]>();
  for (let from=0; from<60000; from+=1000) {
    const {data, error} = await sb.from("nba_player_game_logs").select("player_name,game_date,opponent,minutes_played,points,rebounds,assists,threes_made,is_home,field_goals_attempted,threes_attempted,plus_minus")
      .order("game_date",{ascending:false}).range(from,from+999);
    if (error) throw error;
    for (const g of data ?? []) { const name = resolve(g.player_name); if (!name) continue; byPlayer.set(name,[...(byPlayer.get(name) ?? []), {...g,player_name:name}]); }
    if (!data || data.length<1000) break;
  }
  const teamOf = new Map<string,string>((roster ?? []).map((r:any)=>[r.player_name,r.team]));
  const propLines = new Map<string,number>(), lineOdds = new Map<string,{over:number|null;under:number|null}>(), tonight = new Map<string,string>(), homeTonight = new Map<string,boolean>(), best=new Map<string,number>();
  for (const r of (rawLines ?? []) as RawLine[]) {
    const name=resolve(r.player_name); if (!name) continue;
    const [away,home]=(r.event_label ?? "").split(" @ "), team=teamOf.get(name);
    if (!team || (team!==away && team!==home)) continue;
    const k=`${name.toLowerCase()}|${r.stat}`, j=juice(r)-(r.book==="fanduel" ? 0.01 : 0);
    if (!best.has(k) || j<(best.get(k) ?? Infinity)) {best.set(k,j);propLines.set(k,Number(r.line));lineOdds.set(k,{over:r.over_price,under:r.under_price});}
    tonight.set(name.toLowerCase(),team===home ? away : home); homeTonight.set(name.toLowerCase(),team===home);
  }
  const edges=computeEdges({byPlayer,propLines,lineOdds,tonight,homeTonight,teamOf,
    positionOf:new Map((roster ?? []).map((r:any)=>[r.player_name,r.position])),
    injuries:new Map((injuries ?? []).map((r:any)=>[r.player_name.toLowerCase(),r.status])),today,limit:10000});
  const shelf=[]; const main=[]; const now=Date.now();
  for (const [i,e] of edges.entries()) {
    const p={game_date:today,player_name:e.player,stat:e.stat,side:e.side,line:e.line,odds:e.odds,projection:e.median,win_prob:e.hitRate,model_version:MODEL_VERSION,rank:i+1};
    const market=verifiedSkepticalMarket(p,today,teamOf.get(e.player),events,rawLines ?? [],now);
    if (!market) continue;
    if (main.length<4) main.push({...p,ev:e.ev,opponent:e.tonight,this_season:e.thisSeason,reasons:e.reasons});
    const warnings=pickWarnings(e); if (!warnings.length) continue;
    const history=skepticalHistory(byPlayer.get(e.player) ?? [],today,e.stat,e.side,e.line);
    shelf.push({...p,...market,...history,warnings,trend:e.trend});
  }
  if (main.length) {const {error}=await sb.from("research_pick_log").upsert(main,{onConflict:"game_date,player_name,stat,side,model_version",ignoreDuplicates:true});if(error)throw error;}
  if (shelf.length) {const {error}=await sb.from("research_skeptical_picks").upsert(shelf,{onConflict:"game_date,player_name,stat,side,model_version",ignoreDuplicates:true});if(error)throw error;}
  return {qualifying:edges.length,skeptical:shelf.length,bot:await syncBotFromShelf(sb,today)};
}