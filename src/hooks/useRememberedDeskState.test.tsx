import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRememberedDeskState } from "./useRememberedDeskState";

let saved: Map<string, string>;
beforeEach(() => {
  saved = new Map();
  Object.defineProperty(window, "localStorage", { configurable: true, value: {
    getItem: vi.fn((key: string) => saved.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => saved.set(key, value)),
  } });
});
afterEach(cleanup);

describe("desk state after leaving the site", () => {
  it("restores the selected Results view after the page is recreated", () => {
    const first = renderHook(() => useRememberedDeskState("view", "picks"));
    act(() => first.result.current[1]("results"));
    first.unmount();
    const next = renderHook(() => useRememberedDeskState("view", "picks"));
    expect(next.result.current[0]).toBe("results");
  });
  it("preserves L5 and L10 filters", () => {
    const initial = { minL5Hit: 0, minL10Hit: 0, trend: "all", sort: "l10Median" };
    const first = renderHook(() => useRememberedDeskState("filters", initial));
    act(() => first.result.current[1]({ ...initial, minL5Hit: 0.8, minL10Hit: 0.7 }));
    first.unmount();
    const next = renderHook(() => useRememberedDeskState("filters", initial));
    expect(next.result.current[0]).toEqual({ ...initial, minL5Hit: 0.8, minL10Hit: 0.7 });
  });
  it("keeps the expanded player detail", () => {
    saved.set("desk-ui-v1:open", JSON.stringify("Duncan Robinson"));
    const hook = renderHook(() => useRememberedDeskState<string | null>("open", null));
    expect(hook.result.current[0]).toBe("Duncan Robinson");
  });
  it("keeps values unchanged across pagehide and returning", () => {
    const hook = renderHook(() => useRememberedDeskState("search", ""));
    act(() => hook.result.current[1]("Bam"));
    act(() => { window.dispatchEvent(new Event("pagehide")); window.dispatchEvent(new Event("pageshow")); });
    expect(hook.result.current[0]).toBe("Bam");
    expect(saved.get("desk-ui-v1:search")).toBe(JSON.stringify("Bam"));
  });
  it("ignores malformed stored state", () => {
    saved.set("desk-ui-v1:view", "not json");
    const hook = renderHook(() => useRememberedDeskState("view", "picks"));
    expect(hook.result.current[0]).toBe("picks");
  });
  it("rejects incompatible filter field types", () => {
    saved.set("desk-ui-v1:filters", JSON.stringify({ minL5Hit: "80" }));
    const hook = renderHook(() => useRememberedDeskState("filters", { minL5Hit: 0 }));
    expect(hook.result.current[0]).toEqual({ minL5Hit: 0 });
  });
  it("still allows interaction when phone storage is unavailable", () => {
    vi.mocked(localStorage.getItem).mockImplementation(() => { throw new Error("unavailable"); });
    vi.mocked(localStorage.setItem).mockImplementation(() => { throw new Error("unavailable"); });
    const hook = renderHook(() => useRememberedDeskState("view", "picks"));
    act(() => hook.result.current[1]("research"));
    expect(hook.result.current[0]).toBe("research");
  });
});