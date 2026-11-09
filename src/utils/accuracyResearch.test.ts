import {describe,it,expect} from "vitest";
import {researchAccuracy,type ResearchPick} from "./accuracyResearch";
const row=(overrides:Partial<ResearchPick>={}):ResearchPick=>({id:"1",game_date:"2026-11-08",player_name:"Player",stat:"rebounds",side:"over",line:3.5,win_prob:0.7,hits_l10:8,games_l10:10,warnings:["He's cold right now"],status:"won",result_value:6,model_version:"v5",...overrides});
describe("skeptical accuracy research",()=>{
 it("counts the entire 47-play pool",()=>expect(researchAccuracy(Array.from({length:47},(_,i)=>row({player_name:`Player ${i}`})),"review").n).toBe(47));
 it("never calls retrospective diagnostics pregame calibration",()=>expect(researchAccuracy([row()],"review").retrospective).toBe(true));
 it("excludes pending push void and missing final values",()=>expect(researchAccuracy([row(),row({player_name:"B",status:"open"}),row({player_name:"C",status:"push"}),row({player_name:"D",status:"void"}),row({player_name:"E",result_value:null})],"review")).toMatchObject({n:1,excluded:4}));
 it("computes actual frequency and predicted probability separately",()=>expect(researchAccuracy([row(),row({player_name:"B",status:"lost",result_value:1})],"review")).toMatchObject({actual:0.5,predicted:0.7}));
 it("computes Brier loss concretely",()=>expect(researchAccuracy([row({win_prob:0.8})],"pregame").brier).toBeCloseTo(0.04));
 it("compares warning groups including losses",()=>expect(researchAccuracy([row(),row({player_name:"B",status:"lost"})],"review").groups.find(g=>g.label==="Cold Over")).toMatchObject({n:2,won:1,lost:1}));
 it("places exact 70% into correct bucket",()=>expect(researchAccuracy([row()],"review").buckets[0].label).toBe("70–80%"));
 it("explains winning Under with signed margin",()=>expect(researchAccuracy([row({side:"under",line:4.5,result_value:3})],"review").wins[0].margin).toBe(1.5));
 it("does not count three same-player props as three independent player games",()=>expect(researchAccuracy([row(),row({stat:"points"}),row({stat:"pra"})],"review").playerGames).toBe(1));
 it("deduplicates snapshot rows",()=>expect(researchAccuracy([row(),row()],"review").n).toBe(1));
 it("does not modify predictions or picks",()=>{const rows=[row()];const before=structuredClone(rows);researchAccuracy(rows,"pregame");expect(rows).toEqual(before);});
 it("returns no fabricated zero-percent result when empty",()=>expect(researchAccuracy([],"pregame")).toMatchObject({actual:null,brier:null,predicted:null}));
});