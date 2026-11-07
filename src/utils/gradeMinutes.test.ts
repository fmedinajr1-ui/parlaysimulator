import { describe, expect, it } from "vitest";
import { gradeMinutes } from "../../supabase/functions/_shared/research/gradeMinutes";

function client(game: unknown, date = "2026-11-08", readError: unknown = null, updateError: unknown = null) {
  const updates: unknown[] = [];
  return { updates, from: (table: string) => {
    const chain: Record<string, any> = {};
    for (const k of ["eq", "lt", "ilike"]) chain[k] = () => chain;
    chain.select = () => chain;
    chain.limit = async () => ({ data: [{ id: "1", player_name: "A", game_date: date }], error: null });
    chain.maybeSingle = async () => ({ data: game, error: readError });
    chain.update = (v: unknown) => { updates.push(v); return { eq: async () => ({ error: updateError }) }; };
    return chain;
  } };
}
describe("daily minutes grading", () => {
  it("grades actual played minutes", async () => {
    const sb = client({ minutes_played: 28 }); await gradeMinutes(sb, "2026-11-09");
    expect(sb.updates).toEqual([expect.objectContaining({ actual_minutes: 28, status: "graded" })]);
  });
  it("excludes DNPs", async () => {
    const sb = client({ minutes_played: 0 }); await gradeMinutes(sb, "2026-11-09");
    expect(sb.updates).toEqual([expect.objectContaining({ status: "excluded" })]);
  });
  it("waits for a missing recent box score", async () => {
    const sb = client(null); expect(await gradeMinutes(sb, "2026-11-09")).toEqual({ graded: 0 }); expect(sb.updates).toHaveLength(0);
  });
  it("excludes missing box scores older than three days", async () => {
    const sb = client(null); await gradeMinutes(sb, "2026-11-12"); expect(sb.updates).toEqual([expect.objectContaining({ status: "excluded", actual_minutes: null })]);
  });
  it("does not silently accept failed updates", async () => {
    const sb = client({ minutes_played: 28 }, undefined, null, new Error("write failed")); await expect(gradeMinutes(sb, "2026-11-09")).rejects.toThrow("write failed");
  });
});