// @vitest-environment jsdom
// natally — U.6 tests: the checkout screen (SCREEN.md screen-checkout, 6
// frozen variants; the real QR from the real session URL via the `qrcode`
// dep; per-rail handoff; success Delighted via the bus; the J10
// handoff→success tail; the license-key path; commerce law). Accept line:
// "commerce: 13 variants render; gate→CTA→handoff→success chain binds".

import type { CheckoutSession, Offering } from "@natally/billing";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type CompanionBus, createCompanionBus } from "../../companion/bus";
import type { RedeemResult } from "../paywall/types";
import { CheckoutScreen } from "./checkout-screen";
import { type CheckoutOutcome, type CheckoutScreenProps, deriveCheckoutVariant } from "./types";

const actEnv = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
actEnv.IS_REACT_ACT_ENVIRONMENT = true;

// ---------------------------------------------------------------------------
// Fixtures — runtime data only (INC-19: markers, never sample prose)
// ---------------------------------------------------------------------------

const OFFERING: Offering = { id: "natally-unlimited", priceString: "$24", tier: "unlimited" };
const URL = "https://pay.natally.example/checkout/c-123";
const REDIRECT_SESSION: CheckoutSession = { kind: "redirect", url: URL, offering: OFFERING };
const IAP_SESSION: CheckoutSession = { kind: "iap", offering: OFFERING };
const RC_SESSION: CheckoutSession = { kind: "rc", offering: OFFERING };

function makeProps(overrides: Partial<CheckoutScreenProps> = {}): CheckoutScreenProps {
  const bus: CompanionBus = createCompanionBus();
  return {
    session: REDIRECT_SESSION,
    offline: false,
    outcome: { kind: "waiting" },
    keyEntry: false,
    bus,
    onRetry: vi.fn(),
    onCancel: vi.fn(),
    onOpenCheckout: vi.fn(),
    onUnlock: vi.fn(),
    onToggleKeyEntry: vi.fn(),
    redeemKey: vi.fn(
      async (): Promise<RedeemResult> => ({
        outcome: "valid",
        tier: "unlimited",
      }),
    ),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// jsdom harness (createRoot + act, per stage.test.tsx). Each render mounts a
// keyed instance — a fresh screen per mount, never shared hook state.
// ---------------------------------------------------------------------------

let container: HTMLDivElement;
let root: Root;
let mountSeq = 0;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  mountSeq = 0;
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

const q = (selector: string): Element | null => container.querySelector(selector);
const variant = (): string | null =>
  q('[data-screen="checkout"]')?.getAttribute("data-variant") ?? null;
const text = (): string => container.textContent ?? "";

function renderCheckout(props: CheckoutScreenProps): void {
  mountSeq += 1;
  act(() => {
    root.render(<CheckoutScreen key={mountSeq} {...props} />);
  });
}

function click(selector: string): void {
  const element = q(selector);
  if (element === null) {
    throw new Error(`no element for ${selector}`);
  }
  act(() => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

function type(selector: string, value: string): void {
  const element = q(selector);
  if (!(element instanceof HTMLInputElement)) {
    throw new Error(`no input for ${selector}`);
  }
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setter?.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** Commerce law: at most ONE gilt primary per screen; no pressure copy. */
const BANNED_PRESSURE = [
  "hurry",
  "limited time",
  "don't miss",
  "dont miss",
  "act now",
  "last chance",
  "expires soon",
  "offer ends",
  "only today",
];

function expectCommerceLaw(): void {
  const primaries = container.querySelectorAll('button[data-variant="primary"]');
  expect(primaries.length).toBeLessThanOrEqual(1);
  const rendered = text().toLowerCase();
  for (const phrase of BANNED_PRESSURE) {
    expect(rendered).not.toContain(phrase);
  }
}

// ---------------------------------------------------------------------------
// commerce: 13 variants render; gate→CTA→handoff→success chain binds
// ---------------------------------------------------------------------------

describe("commerce: 13 variants render; gate→CTA→handoff→success chain binds", () => {
  it("renders the 6 frozen checkout variants (SCREEN.md screen-checkout)", async () => {
    const seen = new Set<string>();
    const unlocks: unknown[] = [];

    // 1. handoff — redirect: QR + link + "Open the page again" + key note.
    const handoff = makeProps();
    handoff.bus.subscribeAll((event) => {
      unlocks.push(event);
    });
    renderCheckout(handoff);
    expect(variant()).toBe("handoff");
    seen.add(variant() ?? "");
    await flush(); // the real QR encodes asynchronously
    expect(q('[data-testid="checkout-qr"]')?.getAttribute("data-state")).toBe("ready");
    expect(q('[data-testid="checkout-qr"]')?.getAttribute("data-qr-of")).toBe(URL);
    expect(q('[data-testid="checkout-link"]')?.textContent).toContain(URL);
    expect(text()).toContain("Open the page again");
    expect(text()).toContain("Enter a license key");
    expectCommerceLaw();

    // 2. iap-waiting — the store sheet above; Cancel.
    renderCheckout(makeProps({ session: IAP_SESSION }));
    expect(variant()).toBe("iap-waiting");
    seen.add(variant() ?? "");
    expect(q('[data-testid="checkout-waiting"]')?.textContent).toBe(
      "[store sheet presented · runtime]",
    );
    expectCommerceLaw();

    // 3. rc — the paywall-presented waiting state names its rail truthfully.
    renderCheckout(makeProps({ session: RC_SESSION }));
    expect(variant()).toBe("iap-waiting"); // the frozen set names states, not rails
    expect(q('[data-testid="checkout-waiting"]')?.textContent).toBe(
      "[RevenueCat paywall presented · runtime]",
    );
    expectCommerceLaw();

    // 4. success — the frozen aside; exactly one bus unlock on entry.
    const success = makeProps({ outcome: { kind: "success" } });
    success.bus.subscribeAll((event) => {
      unlocks.push(event);
    });
    renderCheckout(success);
    expect(variant()).toBe("success");
    seen.add(variant() ?? "");
    expect(text()).toContain("Unlocked. Unlimited from here —");
    expect(q('[data-testid="checkout-back-conversation"]')).not.toBeNull();
    expectCommerceLaw();

    // 5. failure — the ember-stroked reason card carries the real reason.
    renderCheckout(makeProps({ outcome: { kind: "failure", reason: "payment declined" } }));
    expect(variant()).toBe("failure");
    seen.add(variant() ?? "");
    const reason = q('[data-testid="checkout-reason"]');
    expect(reason?.getAttribute("data-reason")).toBe("payment declined");
    expect(reason?.textContent).toBe("[payment declined · runtime]");
    expectCommerceLaw();

    // 6. offline — the honest-absence card; Try again.
    renderCheckout(makeProps({ offline: true, session: null }));
    expect(variant()).toBe("offline");
    seen.add(variant() ?? "");
    expect(text()).toContain("No connection");
    expect(text()).toContain("Checkout needs the internet once.");
    expect(q('[data-testid="checkout-try-again"]')).not.toBeNull();
    expectCommerceLaw();

    expect(seen.size).toBe(5); // the sixth frozen variant is its own test below
    expect([...seen].sort()).toEqual(["failure", "handoff", "iap-waiting", "offline", "success"]);
    expect(unlocks).toEqual([{ type: "unlock" }]);
  });

  it("completes the frozen set with enter-license-key — the sixth variant", () => {
    renderCheckout(makeProps({ keyEntry: true }));
    expect(variant()).toBe("enter-license-key");
    expect(q('[data-testid="checkout-key-input"]')?.getAttribute("placeholder")).toBe(
      "[license key · runtime]",
    );
    expect(text()).toContain("Keys look like NATALLY-XXXX-XXXX-XXXX.");
    expect(text()).toContain("Unlock with key");
    expectCommerceLaw();
  });

  it("handoff→success chain: waiting publishes nothing, success publishes unlock once, Back routes home (J10)", async () => {
    const events: unknown[] = [];
    const bus = createCompanionBus();
    bus.subscribeAll((event) => {
      events.push(event);
    });
    const onUnlock = vi.fn();

    renderCheckout(makeProps({ bus, onUnlock, outcome: { kind: "waiting" } }));
    await flush();
    expect(variant()).toBe("handoff");
    expect(events).toEqual([]); // waiting fabricates nothing

    // The wiring's poll resolves: the outcome turns success.
    renderCheckout(makeProps({ bus, onUnlock, outcome: { kind: "success" } }));
    await flush();
    expect(variant()).toBe("success");
    expect(events).toEqual([{ type: "unlock" }]);
    expect(bus.stageState$.current().stage).toBe("delighted");

    click('[data-testid="checkout-back-conversation"]');
    expect(onUnlock).toHaveBeenCalledTimes(1);
    expect(events).toEqual([{ type: "unlock" }]); // still exactly one

    // A fresh success entry (retry-then-success) delights again, exactly once.
    renderCheckout(makeProps({ bus, onUnlock, outcome: { kind: "failure", reason: "timeout" } }));
    expect(variant()).toBe("failure");
    renderCheckout(makeProps({ bus, onUnlock, outcome: { kind: "success" } }));
    await flush();
    expect(events.filter((event) => (event as { type: string }).type === "unlock")).toHaveLength(2);
  });

  it("failure Try again retries; offline Try again retries; iap Cancel cancels; handoff re-opens", async () => {
    const failure = makeProps({ outcome: { kind: "failure", reason: "payment declined" } });
    renderCheckout(failure);
    click('[data-testid="checkout-try-again"]');
    expect(failure.onRetry).toHaveBeenCalledTimes(1);

    const offline = makeProps({ offline: true, session: null });
    renderCheckout(offline);
    click('[data-testid="checkout-try-again"]');
    expect(offline.onRetry).toHaveBeenCalledTimes(1);

    const iap = makeProps({ session: IAP_SESSION });
    renderCheckout(iap);
    click('[data-testid="checkout-cancel"]');
    expect(iap.onCancel).toHaveBeenCalledTimes(1);

    const handoff = makeProps();
    renderCheckout(handoff);
    click('[data-testid="checkout-open-again"]');
    expect(handoff.onOpenCheckout).toHaveBeenCalledTimes(1);
    await flush(); // the QR encode settles inside act — no stray state update
  });

  it("license-key entry path: valid unlocks via the bus; a bad key embers with the real reason; note toggles both ways", async () => {
    // From the handoff's license-key note into key entry.
    const entry = makeProps();
    renderCheckout(entry);
    click('[data-testid="checkout-key-note"]');
    expect(entry.onToggleKeyEntry).toHaveBeenCalledWith(true);

    // valid ⇒ one bus unlock + the wiring callback.
    const bus = createCompanionBus();
    const events: unknown[] = [];
    bus.subscribeAll((event) => {
      events.push(event);
    });
    const onUnlocked = vi.fn();
    renderCheckout(
      makeProps({
        keyEntry: true,
        bus,
        onUnlocked,
        redeemKey: vi.fn(async () => ({ outcome: "valid" as const, tier: "unlimited" as const })),
      }),
    );
    type('[data-testid="checkout-key-input"]', "NATALLY-ABCD-EFGH-JKMN");
    click('[data-testid="checkout-key-submit"]');
    await flush();
    expect(events).toEqual([{ type: "unlock" }]);
    expect(bus.stageState$.current().stage).toBe("delighted");
    expect(onUnlocked).toHaveBeenCalledTimes(1);

    // already-used ⇒ the ember line states the real reason; back toggles out.
    const bad = makeProps({
      keyEntry: true,
      redeemKey: vi.fn(async () => ({ outcome: "already-used" as const })),
    });
    renderCheckout(bad);
    type('[data-testid="checkout-key-input"]', "NATALLY-ABCD-EFGH-JKMN");
    click('[data-testid="checkout-key-submit"]');
    await flush();
    expect(q('[data-testid="checkout-key-ember"]')?.getAttribute("data-reason")).toContain(
      "already used",
    );
    click('[data-testid="checkout-key-back"]');
    expect(bad.onToggleKeyEntry).toHaveBeenCalledWith(false);
  });

  it("a session without a URL renders the honest absence, never a fake QR", async () => {
    renderCheckout(makeProps({ session: { kind: "redirect", offering: OFFERING } }));
    await flush();
    expect(variant()).toBe("handoff");
    const link = q('[data-testid="checkout-link"]');
    expect(link?.getAttribute("data-absence")).toBe("url-absent");
    expect(q('[data-testid="checkout-qr"]')).toBeNull();
  });

  it("derivation stays pure: offline and key entry win, then outcomes, then the rail kind", () => {
    const waiting: CheckoutOutcome = { kind: "waiting" };
    expect(
      deriveCheckoutVariant({ offline: true, keyEntry: true, outcome: waiting, session: null }),
    ).toBe("offline");
    expect(
      deriveCheckoutVariant({ offline: false, keyEntry: true, outcome: waiting, session: null }),
    ).toBe("enter-license-key");
    expect(
      deriveCheckoutVariant({
        offline: false,
        keyEntry: false,
        outcome: { kind: "success" },
        session: REDIRECT_SESSION,
      }),
    ).toBe("success");
    expect(
      deriveCheckoutVariant({
        offline: false,
        keyEntry: false,
        outcome: { kind: "failure", reason: "x" },
        session: REDIRECT_SESSION,
      }),
    ).toBe("failure");
    expect(
      deriveCheckoutVariant({ offline: false, keyEntry: false, outcome: waiting, session: null }),
    ).toBe("offline"); // the honest-absence frame: nothing is in flight
    expect(
      deriveCheckoutVariant({
        offline: false,
        keyEntry: false,
        outcome: waiting,
        session: REDIRECT_SESSION,
      }),
    ).toBe("handoff");
    expect(
      deriveCheckoutVariant({
        offline: false,
        keyEntry: false,
        outcome: waiting,
        session: RC_SESSION,
      }),
    ).toBe("iap-waiting");
  });
});
