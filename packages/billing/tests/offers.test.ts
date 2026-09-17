import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  APPROVED_MICRO_COPY,
  CatalogKindSchema,
  COPY_MONTHLY_SUBTITLE_TEMPLATE,
  COPY_MONTHLY_TITLE,
  COPY_PAYG_SUBTITLE,
  COPY_PAYG_TITLE,
  COPY_UNLIMITED_SUBTITLE,
  COPY_UNLIMITED_TITLE,
  DEFAULT_MONTHLY_AMOUNT,
  depletedBalanceNeverRevokesUnlimited,
  lifetimeNeverRelabelled,
  MICRO_COPY_ADD_CREDITS,
  MICRO_COPY_OFFLINE,
  MICRO_COPY_RESTORE,
  noSilentPaidSwitch,
  OFFER_CATALOG,
  OfferCatalogEntrySchema,
  renderMonthlySubtitle,
  unlimitedNeverMakesRemoteFree,
} from "../src/offers.js";

const copyJson = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "../src/offer-copy.json"), "utf8"),
) as {
  offers: { id: string; title: string; subtitle?: string; subtitleTemplate?: string }[];
  microCopy: { addCredits: string; offline: string; restore: string };
};

describe("OR.1 offer catalog", () => {
  it("defines exactly three offers with the expected ids", () => {
    expect(OFFER_CATALOG).toHaveLength(3);
    expect(OFFER_CATALOG.map((o) => o.id)).toEqual([
      "unlimited-lifetime",
      "pay-as-you-chat",
      "monthly-chat-credits",
    ]);
  });

  it("carries the approved copy byte-exact (§21.1)", () => {
    expect(OFFER_CATALOG[0]?.copy.title).toBe(COPY_UNLIMITED_TITLE);
    expect(COPY_UNLIMITED_TITLE).toBe("Unlimited chats with natally");
    expect(COPY_UNLIMITED_SUBTITLE).toBe("One purchase. Chat with natally as often as you like.");
    expect(COPY_PAYG_TITLE).toBe("Pay as you chat");
    expect(COPY_PAYG_SUBTITLE).toBe("Start with a little credit. Pay only for the chats you use.");
    expect(COPY_MONTHLY_TITLE).toBe("Monthly chat credits");
    expect(COPY_MONTHLY_SUBTITLE_TEMPLATE).toBe("Includes {amount} $ROCHE each month.");
    expect(renderMonthlySubtitle(DEFAULT_MONTHLY_AMOUNT)).toBe(
      `Includes ${DEFAULT_MONTHLY_AMOUNT} $ROCHE each month.`,
    );
  });

  it("stays byte-equal with the offer-copy.json record", () => {
    const [unlimited, payg, monthly] = copyJson.offers;
    expect(copyJson.offers).toHaveLength(3);
    expect(unlimited?.title).toBe(OFFER_CATALOG[0]?.copy.title);
    expect(unlimited?.subtitle).toBe(OFFER_CATALOG[0]?.copy.subtitle);
    expect(payg?.title).toBe(OFFER_CATALOG[1]?.copy.title);
    expect(payg?.subtitle).toBe(OFFER_CATALOG[1]?.copy.subtitle);
    expect(monthly?.title).toBe(OFFER_CATALOG[2]?.copy.title);
    expect(monthly?.subtitleTemplate).toBe(COPY_MONTHLY_SUBTITLE_TEMPLATE);
    expect(copyJson.microCopy.addCredits).toBe(MICRO_COPY_ADD_CREDITS);
    expect(copyJson.microCopy.offline).toBe(MICRO_COPY_OFFLINE);
    expect(copyJson.microCopy.restore).toBe(MICRO_COPY_RESTORE);
  });

  it("carries the approved micro-copy byte-exact (§21.2)", () => {
    expect(MICRO_COPY_ADD_CREDITS).toBe("Add $ROCHE to keep chatting.");
    expect(MICRO_COPY_OFFLINE).toBe("You're offline. Connect to keep chatting.");
    expect(MICRO_COPY_RESTORE).toBe("Restore purchases.");
    expect(APPROVED_MICRO_COPY).toEqual([
      "Add $ROCHE to keep chatting.",
      "You're offline. Connect to keep chatting.",
      "Restore purchases.",
    ]);
  });

  it("separates the three catalog kinds (§21.5)", () => {
    expect(OFFER_CATALOG.map((o) => o.catalogKind)).toEqual([
      "non-consumable",
      "consumable",
      "subscription",
    ]);
    expect(new Set(OFFER_CATALOG.map((o) => o.catalogKind)).size).toBe(3);
  });

  it("gives every offer a distinct entitlement key and distinct product IDs", () => {
    const keys = OFFER_CATALOG.map((o) => o.entitlementKey);
    expect(new Set(keys).size).toBe(3);
    for (const platform of Object.keys(OFFER_CATALOG[0]?.productIds ?? {})) {
      const storeIds = OFFER_CATALOG.map(
        (o) => o.productIds[platform as keyof typeof o.productIds]?.storeProductId,
      );
      const rcIds = OFFER_CATALOG.map(
        (o) => o.productIds[platform as keyof typeof o.productIds]?.rcProductId,
      );
      expect(new Set(storeIds).size).toBe(3);
      expect(new Set(rcIds).size).toBe(3);
      expect(new Set([...storeIds, ...rcIds]).size).toBe(6);
    }
  });

  it("names the currency $ROCHE for customers and ROCHE (no $) for processors (§21.3)", () => {
    for (const offer of OFFER_CATALOG) {
      expect(offer.currencyCode.customer).toBe("$ROCHE");
      expect(offer.currencyCode.processor).toBe("ROCHE");
      expect(offer.currencyCode.processor.includes("$")).toBe(false);
    }
  });

  it("states the subscription's grant kind (§21.5)", () => {
    const subscription = OFFER_CATALOG[2];
    expect(subscription?.catalogKind).toBe("subscription");
    expect(["credits", "local-access", "both"]).toContain(subscription?.grantKind);
    expect(typeof subscription?.monthlyAmount).toBe("number");
  });
});

describe("OR.1 hard rules (§21.1)", () => {
  it("encodes all four hard rules as asserted-true constants", () => {
    expect(depletedBalanceNeverRevokesUnlimited).toBe(true);
    expect(unlimitedNeverMakesRemoteFree).toBe(true);
    expect(noSilentPaidSwitch).toBe(true);
    expect(lifetimeNeverRelabelled).toBe(true);
  });
});

describe("OR.1 OfferCatalogEntrySchema", () => {
  const base = {
    id: "test-offer",
    copy: { title: "T", subtitle: "S" },
    productIds: {
      windows: { storeProductId: "sp.win", rcProductId: "rp.win" },
      "msi-linux": { storeProductId: "sp.linux", rcProductId: "rp.linux" },
      "android-play": { storeProductId: "sp.play", rcProductId: "rp.play" },
      "android-direct": { storeProductId: "sp.direct", rcProductId: "rp.direct" },
      web: { storeProductId: "sp.web", rcProductId: "rp.web" },
    },
    entitlementKey: "ent.key",
    currencyCode: { customer: "$ROCHE", processor: "ROCHE" },
    catalogKind: "consumable",
  } as const;

  it("accepts a well-formed entry", () => {
    expect(() => OfferCatalogEntrySchema.parse(base)).not.toThrow();
    expect(CatalogKindSchema.options).toEqual(["non-consumable", "consumable", "subscription"]);
  });

  it("rejects empty copy", () => {
    expect(
      OfferCatalogEntrySchema.safeParse({ ...base, copy: { title: "", subtitle: "S" } }).success,
    ).toBe(false);
    expect(
      OfferCatalogEntrySchema.safeParse({ ...base, copy: { title: "T", subtitle: "" } }).success,
    ).toBe(false);
  });

  it("rejects a missing entitlement key", () => {
    const { entitlementKey: _omitted, ...rest } = base;
    expect(OfferCatalogEntrySchema.safeParse(rest).success).toBe(false);
    expect(OfferCatalogEntrySchema.safeParse({ ...base, entitlementKey: "" }).success).toBe(false);
  });

  it("rejects '$' in the processor currency code", () => {
    expect(
      OfferCatalogEntrySchema.safeParse({
        ...base,
        currencyCode: { customer: "$ROCHE", processor: "$ROCHE" },
      }).success,
    ).toBe(false);
  });

  it("requires grantKind and monthlyAmount on subscriptions, forbids them elsewhere", () => {
    const subscriptionless = { ...base, catalogKind: "subscription" as const };
    expect(OfferCatalogEntrySchema.safeParse(subscriptionless).success).toBe(false);
    expect(
      OfferCatalogEntrySchema.safeParse({
        ...base,
        catalogKind: "subscription",
        grantKind: "both",
        monthlyAmount: 500,
      }).success,
    ).toBe(true);
    expect(
      OfferCatalogEntrySchema.safeParse({
        ...base,
        catalogKind: "non-consumable",
        grantKind: "both",
      }).success,
    ).toBe(false);
  });
});
