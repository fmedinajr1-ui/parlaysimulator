import { describe, it, expect, vi } from "vitest";
import { botTargetsFromShelf, syncBotFromShelf, botResearchReport, type ShelfPosition } from "../../supabase/functions/_shared/research/botSync";
import { MODEL_VERSION } from "./nbaProjection";

const today="2026-11-09", now=Date.parse("2026-11-09T05:00:00Z");
const row: ShelfPosition={id:"1",game_date:today,player_name:"Player",stat:"points",side:"over",line:20.5,odds:-110,projection:24,win_prob:0.7,hits_l10:5,games_l10:10,warnings:["Model says 70%"],trend:"cold",event_label:"Away @ Home",starts_at:"2026-11-10T00:00:00Z",status:"open",result_value:null,model_version:MODEL_VERSION};
const line={player_name:"Player",stat:"points",line:20.5,over_price:-110,under_price:-110};
function db(responses: Record<string, {data?: unknown; error?: unknown}[]>) {
 const writes:unknown[]=[];
 const sb={from:vi.fn((table:string)=>{
  const q:any={select:()=>q,eq:()=>q,limit:()=>q,upsert:(rows:unknown)=>{writes.push(rows);return q;},then:(ok:any)=>Promise.resolve(responses[table]?.shift() ?? {data:[],error:null}).then(ok)};return q;
 })};return {sb,writes};
}
describe("Saved shelf target contract",()=>{
 it("uses the immutable shelf probability and line",()=>{const p=botTargetsFromShelf([row],today,now,[line]);expect(p[0].win_prob).toBe(0.7);expect(p[0].line).toBe(20.5);});
 it("rejects already-started games",()=>expect(botTargetsFromShelf([{...row,starts_at:new Date(now).toISOString()}],today,now,[line])).toEqual([]));
 it("rejects another slate",()=>expect(botTargetsFromShelf([{...row,game_date:"2026-11-08"}],today,now,[line])).toEqual([]));
 it("rejects another model version",()=>expect(botTargetsFromShelf([{...row,model_version:"v2"}],today,now,[line])).toEqual([]));
 it("requires a matching real line and chosen-side price",()=>{expect(botTargetsFromShelf([row],today,now,[{...line,line:21.5}])).toEqual([]);expect(botTargetsFromShelf([row],today,now,[{...line,over_price:-120}])).toEqual([]);});
 it("caps three targets at 1.5 simulated units",()=>{const rows=["A","B","C","D"].map(player_name=>({...row,player_name}));const p=botTargetsFromShelf(rows,today,now,rows.map(r=>({...line,player_name:r.player_name})));expect(p).toHaveLength(3);expect(p.reduce((n,r)=>n+r.stake_units,0)).toBeLessThanOrEqual(1.5);});
});
describe("Bot synchronization",()=>{
 it("preserves existing daily exposure",async()=>{const {sb,writes}=db({research_bot_picks:[{data:[{id:"old"}]}]});expect(await syncBotFromShelf(sb,today,now)).toEqual({logged:0,preserved:1});expect(writes).toEqual([]);});
 it("saves positions from verified shelf only",async()=>{const {sb,writes}=db({research_bot_picks:[{data:[]},{data:null}],research_skeptical_picks:[{data:[row]}],research_prop_lines:[{data:[line]}]});expect(await syncBotFromShelf(sb,today,now)).toEqual({logged:1});expect((writes[0] as any[])[0].player_name).toBe("Player");});
 it("does not create positions from empty shelf",async()=>{const {sb,writes}=db({research_bot_picks:[{data:[]}],research_skeptical_picks:[{data:[]}],research_prop_lines:[{data:[line]}]});expect(await syncBotFromShelf(sb,today,now)).toEqual({logged:0});expect(writes).toEqual([]);});
 it("surfaces saved-record read failures",async()=>{const {sb}=db({research_bot_picks:[{error:new Error("read failed")}]});await expect(syncBotFromShelf(sb,today,now)).rejects.toThrow("read failed");});
 it("surfaces position save failures",async()=>{const {sb}=db({research_bot_picks:[{data:[]},{error:new Error("save failed")}],research_skeptical_picks:[{data:[row]}],research_prop_lines:[{data:[line]}]});await expect(syncBotFromShelf(sb,today,now)).rejects.toThrow("save failed");});
});
describe("Shared research report",()=>{
 it("keeps pregame and after-game results separate",async()=>{const {sb}=db({research_skeptical_picks:[{data:[{...row,status:"won",result_value:25}]}],research_skeptical_reviews:[{data:[{...row,status:"lost",result_value:10}]}]});const r=await botResearchReport(sb);expect(r.pregame.won).toBe(1);expect(r.retrospective.lost).toBe(1);});
 it("never applies calibration",async()=>{const {sb}=db({});expect((await botResearchReport(sb)).calibrationApplied).toBe(false);});
 it("leaves undecided results excluded",async()=>{const {sb}=db({research_skeptical_picks:[{data:[row]}]});const r=await botResearchReport(sb);expect(r.pregame.total).toBe(1);expect(r.pregame.decided).toBe(0);});
 it("labels retrospective provenance",async()=>{const {sb}=db({});const r=await botResearchReport(sb);expect(r.pregame.retrospective).toBe(false);expect(r.retrospective.retrospective).toBe(true);});
 it("surfaces unavailable research instead of zero accuracy",async()=>{const {sb}=db({research_skeptical_reviews:[{error:new Error("unavailable")}]});await expect(botResearchReport(sb)).rejects.toThrow("unavailable");});
});