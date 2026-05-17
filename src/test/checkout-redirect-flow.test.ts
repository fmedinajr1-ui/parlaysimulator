/**
 * E2E-style test: Safari iOS checkout flow.
 *
 * Simulates the full user journey on a mobile Safari viewport:
 *   1. User is on /dashboard
 *   2. Mobile lifecycle backgrounds the tab (pagehide) -> route would normally persist
 *   3. App triggers redirectToExternalCheckout() -> sets flag, clears persisted route
 *   4. User completes / cancels on Stripe and returns to the site root "/"
 *      with document.referrer set to checkout.stripe.com
 *   5. useRoutePersistence on mount must NOT navigate back to /dashboard
 *
 * Regression guard for the Safari mobile "bounce back to /dashboard" bug.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import {
  ROUTE_STORAGE_KEY,
  CHECKOUT_REDIRECT_STORAGE_KEY,
  redirectToExternalCheckout,
  saveCurrentRoute,
  consumeCheckoutRedirectFlag,
} from '@/utils/routePersistence';

// Real sessionStorage shim (jsdom provides one, but our setup mocks localStorage only)
const storage: Record<string, string> = {};
beforeEach(() => {
  for (const k of Object.keys(storage)) delete storage[k];
  Object.defineProperty(window, 'sessionStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => (k in storage ? storage[k] : null),
      setItem: (k: string, v: string) => { storage[k] = String(v); },
      removeItem: (k: string) => { delete storage[k]; },
      clear: () => { for (const k of Object.keys(storage)) delete storage[k]; },
    },
  });
});

function setLocation(pathname: string, search = '') {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: {
      ...window.location,
      pathname,
      search,
      href: `https://parlayfarm.com${pathname}${search}`,
      origin: 'https://parlayfarm.com',
      assign: vi.fn(),
      replace: vi.fn(),
    },
  });
}

function setReferrer(referrer: string) {
  Object.defineProperty(document, 'referrer', {
    configurable: true,
    get: () => referrer,
  });
}

describe('Safari iOS checkout flow — bounce-back guard', () => {
  it('redirectToExternalCheckout clears persisted route and sets flag', () => {
    setLocation('/dashboard');
    saveCurrentRoute();
    expect(storage[ROUTE_STORAGE_KEY]).toBeTruthy();

    // Stripe URL is captured by overriding the href setter
    let navigated: string | null = null;
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        ...window.location,
        pathname: '/dashboard',
        origin: 'https://parlayfarm.com',
        set href(v: string) { navigated = v; },
        get href() { return 'https://parlayfarm.com/dashboard'; },
      },
    });

    redirectToExternalCheckout('https://checkout.stripe.com/c/pay/abc123');

    expect(storage[ROUTE_STORAGE_KEY]).toBeUndefined();
    expect(storage[CHECKOUT_REDIRECT_STORAGE_KEY]).toBe('true');
    expect(navigated).toBe('https://checkout.stripe.com/c/pay/abc123');
  });

  it('pagehide during checkout redirect does NOT re-persist /dashboard', () => {
    setLocation('/dashboard');
    storage[CHECKOUT_REDIRECT_STORAGE_KEY] = 'true';

    // Simulate the guarded pagehide save
    saveCurrentRoute();

    expect(storage[ROUTE_STORAGE_KEY]).toBeUndefined();
  });

  it('consumeCheckoutRedirectFlag clears flag + persisted route on return', () => {
    storage[ROUTE_STORAGE_KEY] = JSON.stringify({
      pathname: '/dashboard', search: '', scrollY: 0, timestamp: Date.now(),
    });
    storage[CHECKOUT_REDIRECT_STORAGE_KEY] = 'true';

    expect(consumeCheckoutRedirectFlag()).toBe(true);
    expect(storage[CHECKOUT_REDIRECT_STORAGE_KEY]).toBeUndefined();
    expect(storage[ROUTE_STORAGE_KEY]).toBeUndefined();
  });

  it('returning from Stripe to "/" with stale /dashboard route never navigates to /dashboard', async () => {
    // Stale persisted route as if app was killed mid-flow
    storage[ROUTE_STORAGE_KEY] = JSON.stringify({
      pathname: '/dashboard', search: '', scrollY: 0, timestamp: Date.now(),
    });
    // Flag survived (defensive — even if it didn't, referrer check should catch it)
    storage[CHECKOUT_REDIRECT_STORAGE_KEY] = 'true';

    setLocation('/');
    setReferrer('https://checkout.stripe.com/c/pay/abc123');

    const { useRoutePersistence } = await import('@/hooks/useRoutePersistence');

    const navigateSpy = vi.fn();
    vi.doMock('react-router-dom', async (orig) => {
      const actual = await (orig as any)();
      return { ...actual, useNavigate: () => navigateSpy };
    });

    renderHook(() => useRoutePersistence(), {
      wrapper: ({ children }) =>
        React.createElement(MemoryRouter, { initialEntries: ['/'] }, children),
    });

    expect(navigateSpy).not.toHaveBeenCalledWith('/dashboard', expect.anything());
    expect(navigateSpy).not.toHaveBeenCalledWith('/dashboard');
  });

  it('returning from Stripe with NO flag but external referrer still blocks /dashboard restore', async () => {
    storage[ROUTE_STORAGE_KEY] = JSON.stringify({
      pathname: '/dashboard', search: '', scrollY: 0, timestamp: Date.now(),
    });
    // Flag missing — simulate Safari evicting sessionStorage between tab switches
    setLocation('/');
    setReferrer('https://checkout.stripe.com/');

    const { useRoutePersistence } = await import('@/hooks/useRoutePersistence');

    const navigateSpy = vi.fn();
    vi.doMock('react-router-dom', async (orig) => {
      const actual = await (orig as any)();
      return { ...actual, useNavigate: () => navigateSpy };
    });

    renderHook(() => useRoutePersistence(), {
      wrapper: ({ children }) =>
        React.createElement(MemoryRouter, { initialEntries: ['/'] }, children),
    });

    expect(navigateSpy).not.toHaveBeenCalledWith('/dashboard', expect.anything());
    expect(storage[ROUTE_STORAGE_KEY]).toBeUndefined();
  });
});