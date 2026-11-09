import { describe, it, expect } from "vitest";
import { gradeSkepticalPicks } from "../../supabase/functions/_shared/research/gradeSkeptical";
function client(game: object | null, status = "open") {
  const writes: object[] = [];
  const pick = { id:"one",game_date:"2026-11-07",player_name:"Player",stat:"rebounds",side:"under",line:7,status };
  const sb = {from:(table:string)=>({select:()=>({eq:()=>({lt:()=>({limit:async()=>({data:status === "open" ? [pick] : [],error:null})})}),ilike:()=>({eq:()=>({maybeSingle:async()=>({data:game,error:null})})})}),update:(value:object)=>{writes.push(value);return {eq:()=>({eq:async()=>({error:null})})};}})};
  return {sb,writes};
}
describe("complete shelf grading",()=>{
  it("grades the saved side and line as won",async()=>{const c=client({minutes_played:30,rebounds:6});expect(await gradeSkepticalPicks(c.sb,"2026-11-08")).toEqual({graded:1,waiting:0});expect(c.writes[0]).toMatchObject({status:"won",result_value:6});});
  it("grades a loss",async()=>{const c=client({minutes_played:30,rebounds:8});await gradeSkepticalPicks(c.sb,"2026-11-08");expect(c.writes[0]).toMatchObject({status:"lost",result_value:8});});
  it("grades exact-line push",async()=>{const c=client({minutes_played:30,rebounds:7});await gradeSkepticalPicks(c.sb,"2026-11-08");expect(c.writes[0]).toMatchObject({status:"push"});});
  it("does not invent a result for missing box scores",async()=>{const c=client(null);expect(await gradeSkepticalPicks(c.sb,"2026-11-08")).toEqual({graded:0,waiting:1});expect(c.writes).toHaveLength(0);});
  it("does not overwrite settled results",async()=>{const c=client({minutes_played:30,rebounds:8},"won");await gradeSkepticalPicks(c.sb,"2026-11-08");expect(c.writes).toHaveLength(0);});
});