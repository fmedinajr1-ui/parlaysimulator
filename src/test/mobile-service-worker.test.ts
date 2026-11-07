import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

const source = readFileSync(resolve(process.cwd(), "public/sw.js"), "utf8");

async function activateWith(cacheNames: string[], failCleanup = false) {
  const listeners = new Map<string, (event: { waitUntil: (promise: Promise<void>) => void }) => void>();
  const unregister = vi.fn(async () => true);
  const navigate = vi.fn();
  const matchAll = vi.fn(async () => [{ navigate }]);
  const claim = vi.fn(async () => undefined);
  const self = {
    registration: { scope: "https://parlayfarm.com/", unregister },
    clients: { claim, matchAll },
    addEventListener: (name: string, fn: (event: { waitUntil: (promise: Promise<void>) => void }) => void) => listeners.set(name, fn),
    skipWaiting: vi.fn(),
  };
  const caches = {
    keys: vi.fn(async () => cacheNames),
    delete: vi.fn(async () => {
      if (failCleanup) throw new Error("cache unavailable");
      return true;
    }),
  };
  vm.runInNewContext(source, { self, caches, Promise });
  let activation!: Promise<void>;
  listeners.get("activate")!({ waitUntil: (promise) => { activation = promise; } });
  await activation;
  return { unregister, navigate, matchAll, claim, caches };
}

describe("mobile service-worker cleanup", () => {
  it("never navigates an open app when the old worker is removed", async () => {
    const { navigate, matchAll } = await activateWith([]);
    expect(matchAll).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("unregisters the old worker after activation", async () => {
    const { unregister } = await activateWith([]);
    expect(unregister).toHaveBeenCalledOnce();
  });

  it("deletes the old precache without touching the page", async () => {
    const { caches } = await activateWith(["workbox-precache-v2-https://parlayfarm.com/"]);
    expect(caches.delete).toHaveBeenCalledWith("workbox-precache-v2-https://parlayfarm.com/");
  });

  it("preserves unrelated cached data", async () => {
    const { caches } = await activateWith(["research-images", "user-documents"]);
    expect(caches.delete).not.toHaveBeenCalled();
  });

  it("still unregisters without reloading if cache cleanup fails", async () => {
    const { unregister, navigate } = await activateWith(["js-cache-v1"], true);
    expect(unregister).toHaveBeenCalledOnce();
    expect(navigate).not.toHaveBeenCalled();
  });
});
