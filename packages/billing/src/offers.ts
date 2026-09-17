import { z } from "zod";

/**
 * Offer catalog — architecture §21.1 (approved copy, verbatim), §21.2 (customer
 * language law), §21.3 ($ROCHE naming: customer `$ROCHE`, processor code `ROCHE`
 * with no `$`), §21.5 (catalog separation, distinct entitlement keys).
 *
 * The approved copy table also lives verbatim in `offer-copy.json`; the test
 * suite asserts the two stay byte-equal.
 */

export const CURRENCY_CUSTOMER = "$ROCHE" as const;
export const CURRENCY_PROCESSOR = "ROCHE" as const;

// §21.1 approved copy, byte-exact.
export const COPY_UNLIMITED_TITLE = "Unlimited chats with natally" as const;
export const COPY_UNLIMITED_SUBTITLE =
  "One purchase. Chat with natally as often as you like." as const;
export const COPY_PAYG_TITLE = "Pay as you chat" as const;
export const COPY_PAYG_SUBTITLE =
  "Start with a little credit. Pay only for the chats you use." as const;
export const COPY_MONTHLY_TITLE = "Monthly chat credits" as const;
export const COPY_MONTHLY_SUBTITLE_TEMPLATE = "Includes {amount} $ROCHE each month." as const;

// §21.2 approved micro-copy, byte-exact.
export const MICRO_COPY_ADD_CREDITS = "Add $ROCHE to keep chatting." as const;
export const MICRO_COPY_OFFLINE = "You're offline. Connect to keep chatting." as const;
export const MICRO_COPY_RESTORE = "Restore purchases." as const;

// §21.1 hard rules, encoded as asserted constants.
export const depletedBalanceNeverRevokesUnlimited = true as const;
export const unlimitedNeverMakesRemoteFree = true as const;
export const noSilentPaidSwitch = true as const;
export const lifetimeNeverRelabelled = true as const;

export const PlatformIdSchema = z.enum([
  "windows",
  "msi-linux",
  "android-play",
  "android-direct",
  "web",
]);
export type PlatformId = z.infer<typeof PlatformIdSchema>;

export const PlatformProductIdsSchema = z.strictObject({
  storeProductId: z.string().min(1),
  rcProductId: z.string().min(1),
});
export type PlatformProductIds = z.infer<typeof PlatformProductIdsSchema>;

export const CatalogKindSchema = z.enum(["non-consumable", "consumable", "subscription"]);
export type CatalogKind = z.infer<typeof CatalogKindSchema>;

export const GrantKindSchema = z.enum(["credits", "local-access", "both"]);
export type GrantKind = z.infer<typeof GrantKindSchema>;

export const CurrencyCodeSchema = z.strictObject({
  customer: z.literal(CURRENCY_CUSTOMER),
  processor: z
    .string()
    .min(1)
    .refine((code) => !code.includes("$"), {
      message: "processor currency code must not contain '$' (§21.3)",
    }),
});
export type CurrencyCode = z.infer<typeof CurrencyCodeSchema>;

export const OfferCatalogEntrySchema = z
  .strictObject({
    id: z.string().min(1),
    copy: z.strictObject({
      title: z.string().min(1),
      subtitle: z.string().min(1),
    }),
    productIds: z.record(PlatformIdSchema, PlatformProductIdsSchema),
    entitlementKey: z.string().min(1),
    currencyCode: CurrencyCodeSchema,
    catalogKind: CatalogKindSchema,
    grantKind: GrantKindSchema.optional(),
    monthlyAmount: z.number().int().positive().optional(),
  })
  .superRefine((entry, ctx) => {
    if (entry.catalogKind === "subscription") {
      if (entry.grantKind === undefined) {
        ctx.addIssue({
          code: "custom",
          message: "a subscription must state grantKind (§21.5)",
          path: ["grantKind"],
        });
      }
      if (entry.monthlyAmount === undefined) {
        ctx.addIssue({
          code: "custom",
          message: "a subscription must state monthlyAmount (§21.1)",
          path: ["monthlyAmount"],
        });
      }
    } else {
      if (entry.grantKind !== undefined) {
        ctx.addIssue({
          code: "custom",
          message: "grantKind applies only to subscriptions (§21.5)",
          path: ["grantKind"],
        });
      }
      if (entry.monthlyAmount !== undefined) {
        ctx.addIssue({
          code: "custom",
          message: "monthlyAmount applies only to subscriptions (§21.1)",
          path: ["monthlyAmount"],
        });
      }
    }
  });
export type OfferCatalogEntry = z.infer<typeof OfferCatalogEntrySchema>;

export function renderMonthlySubtitle(amount: number): string {
  return COPY_MONTHLY_SUBTITLE_TEMPLATE.replace("{amount}", String(amount));
}

function platformIds(store: string, rc: string): PlatformProductIds {
  return { storeProductId: store, rcProductId: rc };
}

const unlimitedEntry: OfferCatalogEntry = {
  id: "unlimited-lifetime",
  copy: { title: COPY_UNLIMITED_TITLE, subtitle: COPY_UNLIMITED_SUBTITLE },
  productIds: {
    windows: platformIds("natally.unlimited.lifetime", "unlimited_lifetime"),
    "msi-linux": platformIds("natally.unlimited.lifetime", "unlimited_lifetime"),
    "android-play": platformIds("natally.unlimited.lifetime", "unlimited_lifetime"),
    "android-direct": platformIds("natally.unlimited.lifetime.direct", "unlimited_lifetime_direct"),
    web: platformIds("natally.unlimited.lifetime", "unlimited_lifetime"),
  },
  entitlementKey: "unlimited.perpetual",
  currencyCode: { customer: CURRENCY_CUSTOMER, processor: CURRENCY_PROCESSOR },
  catalogKind: "non-consumable",
};

const payAsYouChatEntry: OfferCatalogEntry = {
  id: "pay-as-you-chat",
  copy: { title: COPY_PAYG_TITLE, subtitle: COPY_PAYG_SUBTITLE },
  productIds: {
    windows: platformIds("natally.roche.pack.small", "roche_pack_small"),
    "msi-linux": platformIds("natally.roche.pack.small", "roche_pack_small"),
    "android-play": platformIds("natally.roche.pack.small.play", "roche_pack_small_play"),
    "android-direct": platformIds("natally.roche.pack.small.direct", "roche_pack_small_direct"),
    web: platformIds("natally.roche.pack.small", "roche_pack_small"),
  },
  entitlementKey: "roche.balance",
  currencyCode: { customer: CURRENCY_CUSTOMER, processor: CURRENCY_PROCESSOR },
  catalogKind: "consumable",
};

const MONTHLY_AMOUNT_DEFAULT = 500;

const monthlyCreditsEntry: OfferCatalogEntry = {
  id: "monthly-chat-credits",
  copy: {
    title: COPY_MONTHLY_TITLE,
    subtitle: renderMonthlySubtitle(MONTHLY_AMOUNT_DEFAULT),
  },
  productIds: {
    windows: platformIds("natally.roche.monthly", "roche_monthly"),
    "msi-linux": platformIds("natally.roche.monthly", "roche_monthly"),
    "android-play": platformIds("natally.roche.monthly.play", "roche_monthly_play"),
    "android-direct": platformIds("natally.roche.monthly.direct", "roche_monthly_direct"),
    web: platformIds("natally.roche.monthly", "roche_monthly"),
  },
  entitlementKey: "roche.monthly.grant",
  currencyCode: { customer: CURRENCY_CUSTOMER, processor: CURRENCY_PROCESSOR },
  catalogKind: "subscription",
  grantKind: "both",
  monthlyAmount: MONTHLY_AMOUNT_DEFAULT,
};

export const DEFAULT_MONTHLY_AMOUNT = MONTHLY_AMOUNT_DEFAULT;

export const OFFER_CATALOG: readonly [OfferCatalogEntry, OfferCatalogEntry, OfferCatalogEntry] = [
  unlimitedEntry,
  payAsYouChatEntry,
  monthlyCreditsEntry,
];

export const APPROVED_MICRO_COPY: readonly [string, string, string] = [
  MICRO_COPY_ADD_CREDITS,
  MICRO_COPY_OFFLINE,
  MICRO_COPY_RESTORE,
];
