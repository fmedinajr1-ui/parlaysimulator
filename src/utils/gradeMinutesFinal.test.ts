import { describe, expect, it } from "vitest";
import { gradeMinutes } from "../../supabase/functions/_shared/research/gradeMinutes";

function client() {
  const updates: unknown[] = [];
  return { updates, from: (table: string) => {
    const chain: Record<string, any> = {};
    for (const k of ["eq", "lt", "ilike"]) chain[k] = () => chain;
    chain.select = () => chain;
    chain.limit = async () => table === "research_minutes_log"
      ? { data: [{ id: "1", player_name: "Missing Player", game_date: "2026-11-07", team: "Orlando Magic" }], error: null }
      : { data: [], error: null };
    chain.maybeSingle = async () => ({ data: null, error: null });
    chain.update = (value: unknown) => { updates.push(value); return { eq: async () => ({ error: null }) }; };
    return chain;
  } };
}
const board = (completed = true) => ({ events: [{ id: "game1", status: { type: { completed } }, competitions: [{ competitors: [{ team: { displayName: "Orlando Magic" } }] }] }] });
const summary = (athletes: unknown[]) => ({ boxscore: { players: [{ statistics: [{ athletes }] }] } });
const athlete = (name: string, didNotPlay: boolean, stats: number[] = [20]) => ({ athlete: { displayName: name }, didNotPlay, stats });
const fetcher = (summaryBody: unknown) => async (url: string) => url.includes("scoreboard") ? board() : summaryBody;

describe("final-game minutes exclusions", () => {
  it("excludes a player absent from a completed game's box score", async () => {
    const sb = client(); await gradeMinutes(sb, "2026-11-08", fetcher(summary([athlete("Other Player", false)])));
    expect(sb.updates).toEqual([expect.objectContaining({ status: "excluded", actual_minutes: null })]);
  });
  it("excludes an explicit DNP", async () => {
    const sb = client(); await gradeMinutes(sb, "2026-11-08", fetcher(summary([athlete("Missing Player", true, [])])));
    expect(sb.updates).toEqual([expect.objectContaining({ status: "excluded" })]);
  });
  it("waits when the player has stats but the database is behind", async () => {
    const sb = client(); expect(await gradeMinutes(sb, "2026-11-08", fetcher(summary([athlete("Missing Player", false)])))).toEqual({ graded: 0 });
    expect(sb.updates).toHaveLength(0);
  });
  it("does not exclude before the game is final", async () => {
    const sb = client(); await gradeMinutes(sb, "2026-11-08", async () => board(false));
    expect(sb.updates).toHaveLength(0);
  });
  it("fails safe when ESPN is unavailable", async () => {
    const sb = client(); await gradeMinutes(sb, "2026-11-08", async () => { throw new Error("feed down"); });
    expect(sb.updates).toHaveLength(0);
  });
  it("still expires a missing forecast after three days", async () => {
    const sb = client(); await gradeMinutes(sb, "2026-11-11", async () => { throw new Error("feed down"); });
    expect(sb.updates).toEqual([expect.objectContaining({ status: "excluded" })]);
  });
});
