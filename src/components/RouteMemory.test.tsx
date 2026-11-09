import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { RouteMemory } from "./RouteMemory";

function setHeight(h: number) {
  Object.defineProperty(document.documentElement, "scrollHeight", { configurable: true, value: h });
}

describe("RouteMemory scroll restore", () => {
  let scrollTo: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.useFakeTimers();
    const mem = new Map<string, string>();
    Object.defineProperty(window, "localStorage", { configurable: true, writable: true, value: {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
      removeItem: (k: string) => void mem.delete(k),
      clear: () => mem.clear(),
    } });
    sessionStorage.clear();
    localStorage.setItem("last_scroll_v1", JSON.stringify({ path: "/", y: 1200 }));
    scrollTo = vi.fn();
    window.scrollTo = scrollTo as unknown as typeof window.scrollTo;
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 700 });
  });
  afterEach(() => vi.useRealTimers());

  it("waits until the page is tall enough, then scrolls exactly once", () => {
    setHeight(900);
    render(<MemoryRouter initialEntries={["/"]}><RouteMemory /></MemoryRouter>);
    vi.advanceTimersByTime(1500);
    expect(scrollTo).not.toHaveBeenCalled();
    setHeight(2500);
    vi.advanceTimersByTime(1500);
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenCalledWith(0, 1200);
  });

  it("a touch cancels the restore so the page never jumps under the reader", () => {
    setHeight(900);
    render(<MemoryRouter initialEntries={["/"]}><RouteMemory /></MemoryRouter>);
    window.dispatchEvent(new Event("touchstart"));
    setHeight(2500);
    vi.advanceTimersByTime(7000);
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("gives up after about 6 seconds if the page never gets tall enough", () => {
    setHeight(900);
    render(<MemoryRouter initialEntries={["/"]}><RouteMemory /></MemoryRouter>);
    vi.advanceTimersByTime(7000);
    setHeight(2500);
    vi.advanceTimersByTime(3000);
    expect(scrollTo).not.toHaveBeenCalled();
  });
});
