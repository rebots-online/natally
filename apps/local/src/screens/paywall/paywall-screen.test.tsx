// @vitest-environment jsdom
// natally — U.6 tests: the paywall screen (SCREEN.md screen-paywall, 7 frozen
// variants; the B.5c ways-to-pay readout; the B.1 gate binding; the B.4
// four-outcome redeem; the J10 gate→CTA→handoff chain; commerce law).
// Accept line:
// "commerce: 13 variants render; gate→CTA→handoff→success chain binds".

import type { CheckoutSession, Offering } from "@natally/billing";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type CompanionBus, createCompanionBus } from "../../companion/bus";
import { derivePaywallVariant, PaywallScreen, trialPlateRows } from "./paywall-screen";
import type {
  PaywallRegistry,
  PaywallScreenProps,
  PaywallVariant,
  RedeemResult,
  TrialGate,
} from "./types";

const actEnv = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
actEnv.IS_REACT_ACT_ENVIRONMENT = true;

// ---------------------------------------------------------------------------
// Fixtures — runtime data only (INC-19: markers, never sample prose)
// ---------------------------------------------------------------------------

const OFFERING: Offering = { id: "natally-unlimited", priceString: "$24", tier: "unlimited" };
const SESSION: CheckoutSession = {
  kind: "redirect",
  url: "https://pay.natally.example/checkout/c-123",
  offering: OFFERING,
};
/** 2026-09-19 (rate-limited next-reading date fixture). */
const NEXT_READING_AT = Date.UTC(2026, 8, 19, 12, 0, 0);

function makeProps(overrides: Partial<PaywallScreenProps> = {}): PaywallScreenProps {
  const bus: CompanionBus = createCompanionBus();
  const registry: PaywallRegistry = {
    availableIds: ["stripe", "paypal"],
    purchase: vi.fn(async () => SESSION),
    redeem: vi.fn(
      async (): Promise<RedeemResult> => ({
        outcome: "valid",
        tier: "unlimited",
        exp: NEXT_READING_AT,
      }),
    ),
  };
  return {
    gate: { state: "trial-exhausted" },
    trial: { used: 3, limit: 3, trialModel: "chat-turboquant-q4km" },
    offering: OFFERING,
    registry,
    bus,
    onHandoff: vi.fn(),
    onUnlocked: vi.fn(),
    onRestore: vi.fn(),
    onBack: vi.fn(),
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
  q('[data-screen="paywall"]')?.getAttribute("data-variant") ?? null;
const text = (): string => container.textContent ?? "";

function renderPaywall(props: PaywallScreenProps): void {
  mountSeq += 1;
  act(() => {
    root.render(<PaywallScreen key={mountSeq} {...props} />);
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

/** Drive the screen into the code card and apply `code` through `redeem`. */
async function applyCode(
  base: PaywallScreenProps,
  code: string,
  redeem: PaywallRegistry["redeem"],
): Promise<void> {
  renderPaywall({
    ...base,
    registry: { availableIds: ["stripe"], purchase: vi.fn(), redeem },
  });
  click('[data-testid="paywall-enter-code"]');
  type('[data-testid="paywall-code-input"]', code);
  click('[data-testid="paywall-apply-code"]');
  await flush();
}

// ---------------------------------------------------------------------------
// commerce: 13 variants render; gate→CTA→handoff→success chain binds
// ---------------------------------------------------------------------------

describe("commerce: 13 variants render; gate→CTA→handoff→success chain binds", () => {
  it("renders the 7 frozen paywall variants (SCREEN.md screen-paywall)", async () => {
    const seen = new Set<string>();

    // 1. trial-active — the resting offer.
    renderPaywall(makeProps({ gate: { state: "trial-active", remaining: 2 } }));
    expect(variant()).toBe("trial-active");
    seen.add(variant() ?? "");
    expect(text()).toContain("Unlock natally");
    expect(text()).toContain("[readings left · 2 of 3 · runtime]");
    expectCommerceLaw();

    // 2. trial-exhausted — the J10 entry point; counter reads 3 of 3.
    renderPaywall(makeProps());
    expect(variant()).toBe("trial-exhausted");
    seen.add(variant() ?? "");
    expect(text()).toContain("[readings used · 3 of 3 · runtime]");
    expectCommerceLaw();

    // 3. rate-limited — the next-reading date replaces the counter.
    renderPaywall(makeProps({ gate: { state: "rate-limited", nextReadingAt: NEXT_READING_AT } }));
    expect(variant()).toBe("rate-limited");
    seen.add(variant() ?? "");
    expect(text()).toContain("[next reading · 2026-09-19 · runtime]");
    expect(text()).not.toContain("readings used");
    expect(text()).not.toContain("readings left");
    expectCommerceLaw();

    // 4. already-unlocked — no trial plate, no purchase buttons, back CTA.
    renderPaywall(makeProps({ gate: { state: "licensed" } }));
    expect(variant()).toBe("already-unlocked");
    seen.add(variant() ?? "");
    expect(q('[data-testid="paywall-plate-trial"]')).toBeNull();
    expect(q('[data-testid="paywall-unlock"]')).toBeNull();
    expect(q('[data-testid="paywall-enter-code"]')).toBeNull();
    expect(q('[data-testid="paywall-restore"]')).toBeNull();
    expect(q('[data-testid="paywall-ways-to-pay"]')).toBeNull();
    expect(q('[data-testid="paywall-back"]')).not.toBeNull();
    expectCommerceLaw();

    // 5. enter-code — the code card replaces the purchase block.
    renderPaywall(makeProps({ gate: { state: "trial-active", remaining: 1 } }));
    click('[data-testid="paywall-enter-code"]');
    expect(variant()).toBe("enter-code");
    seen.add(variant() ?? "");
    expect(q('[data-testid="paywall-code-input"]')).not.toBeNull();
    expect(text()).toContain("Single-use and hash-based codes both work.");
    expect(q('[data-testid="paywall-unlock"]')).toBeNull();
    expect(text()).toContain("Apply code");
    expectCommerceLaw();

    // 6. code-error — the ember line states the real reason.
    await applyCode(makeProps(), "NATALLY-WRONG-CODE", async () => ({
      outcome: "invalid" as const,
    }));
    expect(variant()).toBe("code-error");
    seen.add(variant() ?? "");
    const ember = q('[data-testid="paywall-ember"]');
    expect(ember?.getAttribute("data-reason")).toContain("isn't a natally code");
    expect(ember?.textContent).toBe(
      "[That code isn't a natally code — check it and try again. · runtime]",
    );
    expectCommerceLaw();

    // 7. desktop — the 430 column centred (layout frame of the resting base).
    renderPaywall(makeProps({ gate: { state: "trial-active", remaining: 2 }, layout: "desktop" }));
    expect(variant()).toBe("desktop");
    seen.add(variant() ?? "");
    expect(q('[data-screen="paywall"]')?.getAttribute("data-layout")).toBe("desktop");
    expectCommerceLaw();

    expect(seen.size).toBe(7);
    expect([...seen].sort()).toEqual(
      [
        "already-unlocked",
        "code-error",
        "desktop",
        "enter-code",
        "rate-limited",
        "trial-active",
        "trial-exhausted",
      ].sort(),
    );
  });

  it("gate→CTA→handoff: Unlock natally purchases the first present rail and hands off the real session (J10)", async () => {
    const purchase = vi.fn(async () => SESSION);
    const onHandoff = vi.fn();
    renderPaywall(
      makeProps({
        registry: { availableIds: ["stripe", "paypal"], purchase, redeem: vi.fn() },
        onHandoff,
      }),
    );

    click('[data-testid="paywall-unlock"]');
    await flush();

    expect(purchase).toHaveBeenCalledTimes(1);
    expect(purchase).toHaveBeenCalledWith("stripe", OFFERING);
    expect(onHandoff).toHaveBeenCalledTimes(1);
    expect(onHandoff).toHaveBeenCalledWith(SESSION);
  });

  it("enter-a-code: the four B.4 outcomes map — valid publishes unlock (Delighted), the rest ember with the real reason (J11)", async () => {
    // valid ⇒ the bus unlock event (the Delighted moment) + the wiring callback.
    const bus = createCompanionBus();
    const unlockEvents: unknown[] = [];
    bus.subscribeAll((event) => {
      unlockEvents.push(event);
    });
    const onUnlocked = vi.fn();
    await applyCode(makeProps({ bus, onUnlocked }), "NATALLY-AAAA-BBBB-CCCC", async () => ({
      outcome: "valid" as const,
      tier: "unlimited" as const,
    }));
    expect(unlockEvents).toContainEqual({ type: "unlock" });
    expect(bus.stageState$.current().stage).toBe("delighted");
    expect(onUnlocked).toHaveBeenCalledTimes(1);

    // already-used / expired / invalid ⇒ the ember line, each the real reason.
    const cases: readonly {
      readonly outcome: "already-used" | "expired" | "invalid";
      readonly exp?: number;
      readonly phrase: string;
    }[] = [
      { outcome: "already-used", phrase: "already used" },
      { outcome: "expired", exp: Date.UTC(2026, 0, 31), phrase: "expired on 2026-01-31" },
      { outcome: "expired", phrase: "has expired" },
      { outcome: "invalid", phrase: "isn't a natally code" },
    ];
    for (const item of cases) {
      await applyCode(makeProps(), "NATALLY-AAAA-BBBB-CCCC", async () => ({
        outcome: item.outcome,
        ...(item.exp === undefined ? {} : { exp: item.exp }),
      }));
      expect(variant()).toBe("code-error");
      expect(q('[data-testid="paywall-ember"]')?.getAttribute("data-reason")).toContain(
        item.phrase,
      );
    }
  });

  it("binds the B.5c honest ways-to-pay readout; absent rails or offering disable the CTA (never a fake purchase)", async () => {
    // Present rails only, in canonical order (B.5c paymentsAvailable).
    const purchase = vi.fn(async () => SESSION);
    renderPaywall(
      makeProps({ registry: { availableIds: ["paypal", "stripe"], purchase, redeem: vi.fn() } }),
    );
    expect(q('[data-testid="paywall-ways-to-pay"]')?.textContent).toBe(
      "Ways to pay: Card — Stripe · PayPal",
    );

    // Empty install ⇒ the honest absence line; the CTA is inert.
    renderPaywall(
      makeProps({ registry: { availableIds: [], purchase: vi.fn(), redeem: vi.fn() } }),
    );
    const absence = q('[data-testid="paywall-ways-to-pay"]');
    expect(absence?.getAttribute("data-absence")).toBe("rails-absent");
    expect(absence?.textContent).toContain("No payment rails are wired on this install.");
    expect(q('[data-testid="paywall-unlock"]')?.hasAttribute("disabled")).toBe(true);

    // No offering yet (runtime not loaded) ⇒ absence marker + inert CTA.
    renderPaywall(makeProps({ offering: undefined }));
    expect(q('[data-testid="paywall-offering"]')?.textContent).toBe(
      "[offering · unavailable · runtime]",
    );
    expect(q('[data-testid="paywall-unlock"]')?.hasAttribute("disabled")).toBe(true);
    expect(purchase).not.toHaveBeenCalled();
  });

  it("derivation and plate rows stay pure and honest (rate date, counter, licensed emptiness)", () => {
    expect(derivePaywallVariant({ state: "trial-active" }, false, false, true)).toBe("desktop");
    expect(derivePaywallVariant({ state: "trial-exhausted" }, false, false, true)).toBe(
      "trial-exhausted",
    );
    expect(derivePaywallVariant({ state: "trial-active" }, true, false, true)).toBe("enter-code");
    expect(derivePaywallVariant({ state: "licensed" }, false, false, false)).toBe(
      "already-unlocked",
    );

    const gate: TrialGate = { state: "rate-limited", nextReadingAt: NEXT_READING_AT };
    expect(trialPlateRows(gate, 1, 3)).toEqual(["[next reading · 2026-09-19 · runtime]"]);
    expect(trialPlateRows({ state: "trial-exhausted" }, 3, 3)).toEqual([
      "[readings used · 3 of 3 · runtime]",
    ]);
    expect(trialPlateRows({ state: "trial-active", remaining: 2 }, 1, 3)).toEqual([
      "[readings left · 2 of 3 · runtime]",
    ]);
    expect(trialPlateRows({ state: "licensed" }, 0, 0)).toEqual([]);

    const names: readonly PaywallVariant[] = [
      "trial-active",
      "trial-exhausted",
      "rate-limited",
      "already-unlocked",
      "enter-code",
      "code-error",
      "desktop",
    ];
    expect(names).toHaveLength(7);
  });
});
