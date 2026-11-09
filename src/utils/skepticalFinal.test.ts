import {describe,it,expect} from "vitest";
import {skepticalFinal} from "../../supabase/functions/_shared/research/skepticalFinal";
const pick={player_name:"Player",stat:"threes_made",side:"over",line:3.5};
const summary=(completed=true,stats=["30","12","6","2","3-8"],didNotPlay=false)=>({header:{competitions:[{status:{type:{completed}}}]},boxscore:{players:[{statistics:[{keys:["minutes","points","rebounds","assists","threePointFieldGoalsMade-threePointFieldGoalsAttempted"],athletes:[{athlete:{displayName:"Player"},stats,didNotPlay}]}]}]}});
describe("ESPN skeptical final verification",()=>{
 it("requires final, not live",()=>expect(skepticalFinal(pick,summary(false))).toBeNull());
 it("uses made threes, not attempted threes",()=>expect(skepticalFinal(pick,summary())).toEqual({status:"lost",result_value:3}));
 it("computes PRA from all three stats",()=>expect(skepticalFinal({...pick,stat:"pra",line:19.5},summary())).toEqual({status:"won",result_value:20}));
 it("does not guess absent player's result",()=>expect(skepticalFinal({...pick,player_name:"Other"},summary())).toBeNull());
 it("voids explicitly confirmed DNP",()=>expect(skepticalFinal(pick,summary(true,[],true))).toEqual({status:"void",result_value:null}));
 it("rejects incomplete stats",()=>expect(skepticalFinal(pick,summary(true,["30"]))).toBeNull());
});