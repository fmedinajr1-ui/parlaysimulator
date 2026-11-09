import { describe, it, expect } from "vitest";
import { skepticalAccuracy, skepticalHistory, verifiedSkepticalMarket } from "../../supabase/functions/_shared/research/skeptical";
import type { GameLog } from "./nbaBoxScoreMath";
const game = (date: string, value = 3, minutes = 30): GameLog => ({ player_name: "Player", game_date: date, minutes_played: minutes, opponent: "Away", points: value, rebounds: 2, assists: 1, threes_made: value });
describe("skeptical pregame last ten", () => {
  it("never uses tonight's result", () => expect(skepticalHistory([game("2026-11-08", 9), game("2026-11-07", 3)], "2026-11-08", "threes_made", "over", 3.5).hits_l10).toBe(0));
  it("counts the actual Over, not season appearances", () => expect(skepticalHistory([game("2026-11-07", 5), game("2026-11-06", 3)], "2026-11-08", "threes_made", "over", 3.5).hits_l10).toBe(1));
  it("counts Under at its saved line", () => expect(skepticalHistory([game("2026-11-07", 2), game("2026-11-06", 4)], "2026-11-08", "points", "under", 3).hits_l10).toBe(1));
  it("excludes pushes from hits", () => expect(skepticalHistory([game("2026-11-07", 3)], "2026-11-08", "points", "under", 3).hits_l10).toBe(0));
  it("excludes DNP and duplicate games", () => expect(skepticalHistory([game("2026-11-07"), game("2026-11-07"), game("2026-11-06", 0, 0)], "2026-11-08", "points", "over", 2).games_l10).toBe(1));
  it("keeps exactly the newest ten with dates and values", () => {
    const result = skepticalHistory(Array.from({length: 12}, (_, i) => game(`2026-10-${String(i + 1).padStart(2, "0")}`, i)), "2026-11-08", "pra", "over", 10);
    expect(result.history_l10).toHaveLength(10); expect(result.history_l10[0]).toEqual({game_date: "2026-10-12", value: 14});
  });
});
const row = (status: string, i = 0) => ({game_date: "2026-11-08", player_name: `Player ${i}`, stat: "points", side: "over", model_version: "v5-rest-aware", status});
describe("complete shelf accuracy", () => {
  it("counts the whole 47-play shelf, not top three", () => expect(skepticalAccuracy(Array.from({length:47}, (_,i)=>row("won",i))).total).toBe(47));
  it("reports wins divided by wins plus losses only", () => expect(skepticalAccuracy([row("won"),row("lost",1),row("open",2),row("push",3),row("void",4)]).accuracy).toBe(0.5));
  it("does not turn an empty record into zero accuracy", () => expect(skepticalAccuracy([]).accuracy).toBeNull());
  it("keeps pending separate", () => expect(skepticalAccuracy([row("open")])).toMatchObject({open:1,won:0,lost:0,accuracy:null}));
  it("does not count duplicates twice", () => expect(skepticalAccuracy([row("won"),row("won")]).won).toBe(1));
});
const pick = {game_date:"2026-11-08",player_name:"Player",stat:"points",line:3.5};
const events = [{date:"2026-11-09T00:00:00Z",status:{type:{state:"pre"}},competitions:[{competitors:[{team:{displayName:"Home"}},{team:{displayName:"Away"}}]}]}];
const lines = [{player_name:"Player",stat:"points",line:3.5,event_label:"Away @ Home",over_price:-110,under_price:-110}];
const now = Date.parse("2026-11-08T23:00:00Z");
describe("verified pregame shelf market",()=>{
  it("accepts real pregame market",()=>expect(verifiedSkepticalMarket(pick,pick.game_date,"Home",events,lines,now)).toEqual({starts_at:events[0].date,event_label:"Away @ Home"}));
  it("rejects an already started game",()=>expect(verifiedSkepticalMarket(pick,pick.game_date,"Home",events,lines,Date.parse(events[0].date))).toBeNull());
  it("rejects wrong roster team",()=>expect(verifiedSkepticalMarket(pick,pick.game_date,"Other",events,lines,now)).toBeNull());
  it("rejects an absent real line",()=>expect(verifiedSkepticalMarket({...pick,line:4.5},pick.game_date,"Home",events,lines,now)).toBeNull());
  it("rejects wrong date",()=>expect(verifiedSkepticalMarket(pick,"2026-11-09","Home",events,lines,now)).toBeNull());
  it("rejects live even if tip time is future",()=>expect(verifiedSkepticalMarket(pick,pick.game_date,"Home",[{...events[0],status:{type:{state:"in"}}}],lines,now)).toBeNull());
});