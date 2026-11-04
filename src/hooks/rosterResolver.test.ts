import { rosterResolver } from "./useResearchData";
import { test, expect } from "vitest";
const r = rosterResolver(["Herbert Jones","Darryn Peterson","Tristan da Silva","Jabari Smith Jr."]);
test("herb", ()=>expect(r("Herb Jones")).toBe("Herbert Jones"));
test("drew not darryn", ()=>expect(r("Drew Peterson")).toBe(null));
test("case", ()=>expect(r("Tristan Da Silva")).toBe("Tristan da Silva"));
test("suffix", ()=>expect(r("Jabari Smith")).toBe("Jabari Smith Jr."));
test("gone", ()=>expect(r("Keon Johnson")).toBe(null));
