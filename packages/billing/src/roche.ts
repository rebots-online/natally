import { z } from "zod";

// §21.3 — $ROCHE virtual currency contract.
// Integer units, bounded 0..2×10⁹ inclusive, no-negative invariant unbreakable.
// Authority split: RevenueCat is the system of record for balances and
// purchase-driven grants; the application service owns jobs, reservations,
// provenance and reconciliation and NEVER computes a second wallet total — it
// must consume `RocheBalanceSource` below instead of summing anything itself.

/** Unit precision is defined exactly once, here. ROCHE units are integers. */
export const ROCHE_UNIT_PRECISION = 0 as const;
export const ROCHE_MIN_UNITS = 0;
export const ROCHE_MAX_UNITS = 2_000_000_000;

export const RocheUnitsSchema = z.number().int().min(ROCHE_MIN_UNITS).max(ROCHE_MAX_UNITS);
export type RocheUnits = z.infer<typeof RocheUnitsSchema>;

export class RocheUnitsError extends Error {
  constructor(value: number, label: string) {
    super(
      `${label}: ${value} is not valid $ROCHE units (integer, ${ROCHE_MIN_UNITS}..${ROCHE_MAX_UNITS})`,
    );
    this.name = "RocheUnitsError";
  }
}

export function isRocheUnits(value: number): value is RocheUnits {
  return RocheUnitsSchema.safeParse(value).success;
}

export function assertRocheUnits(value: number, label: string): asserts value is RocheUnits {
  if (!isRocheUnits(value)) throw new RocheUnitsError(value, label);
}

// ---------------------------------------------------------------------------
// Fungibility matrix (§21.3) — closed enum + predicate.
// ---------------------------------------------------------------------------

/** Purchase origin of a $ROCHE grant. Closed set (SC1): appending is a decision event. */
export const RocheOriginSchema = z.enum([
  "windows-msix",
  "direct-msi-linux",
  "hosted-web-pwa",
  "google-play",
  "direct-android",
  "future-apple",
]);
export type RocheOrigin = z.infer<typeof RocheOriginSchema>;

/** Eligibility pool a grant belongs to. Closed set (SC1). */
export const RochePoolSchema = z.enum([
  "common",
  "google-play-app",
  "direct-android",
  "future-apple",
]);
export type RochePool = z.infer<typeof RochePoolSchema>;

export const FungibilityRowSchema = z.strictObject({
  origin: RocheOriginSchema,
  pool: RochePoolSchema,
  fungible: z.boolean(),
  rule: z.string().min(1),
});
export type FungibilityRow = z.infer<typeof FungibilityRowSchema>;

/** §21.3 fungibility matrix, one row per origin. Closed set — never silently appended. */
export const FUNGIBILITY_MATRIX = [
  {
    origin: "windows-msix",
    pool: "common",
    fungible: true,
    rule: "Windows MSIX purchases flow into the common eligible pool (§21.3).",
  },
  {
    origin: "direct-msi-linux",
    pool: "common",
    fungible: true,
    rule: "Direct MSI/Linux purchases flow into the common eligible pool (§21.3).",
  },
  {
    origin: "hosted-web-pwa",
    pool: "common",
    fungible: true,
    rule: "Hosted web+PWA purchases flow into the common eligible pool (§21.3).",
  },
  {
    origin: "google-play",
    pool: "google-play-app",
    fungible: false,
    rule: "Play Payments policy: currency restricted to the originating app (§21.3).",
  },
  {
    origin: "direct-android",
    pool: "direct-android",
    fungible: false,
    rule: "Direct Android is a distinct origin from Play and never mixes with it (§21.3).",
  },
  {
    origin: "future-apple",
    pool: "future-apple",
    fungible: false,
    rule: "Future Apple legs follow StoreKit/RevenueCat rules; restricted until ratified (§21.3).",
  },
] as const satisfies readonly FungibilityRow[];

export function fungibilityOf(origin: RocheOrigin): FungibilityRow {
  const row = FUNGIBILITY_MATRIX.find((entry) => entry.origin === origin);
  if (!row) throw new Error(`no fungibility row for origin ${origin}`);
  return row;
}

/**
 * Can a credit of `origin` be applied into `pool`? Restricted-origin credits
 * never silently mix into unrestricted funds: each origin applies only into
 * its own matrix pool.
 */
export function canApply(origin: RocheOrigin, pool: RochePool): boolean {
  return fungibilityOf(origin).pool === pool;
}

export class RocheMixingError extends Error {
  constructor(origins: readonly RocheOrigin[]) {
    super(`mixing restricted-origin credits across pools is forbidden: ${origins.join(", ")}`);
    this.name = "RocheMixingError";
  }
}

/** Throws when the given origin set spans more than one fungibility pool. */
export function assertNoMixing(origins: readonly RocheOrigin[]): void {
  const pools = new Set(origins.map((origin) => fungibilityOf(origin).pool));
  if (pools.size > 1) throw new RocheMixingError(origins);
}

// ---------------------------------------------------------------------------
// Balance authority split (§21.3).
// ---------------------------------------------------------------------------

/**
 * The single read boundary for $ROCHE balances. RevenueCat is the system of
 * record for balances and purchase-driven grants; the application service
 * consumes this interface for every balance question and NEVER computes a
 * second wallet total from grants, events or its own bookkeeping. All
 * participating projects call the same spend boundary through this seam.
 */
export interface RocheBalanceSource {
  balanceOf(account: string, pool: RochePool): number;
}

// ---------------------------------------------------------------------------
// Grant/refund lifecycle (§21.6) — pure functions over a GrantLedger state.
// The in-memory store is the seam; persistence is another task's Owns.
// ---------------------------------------------------------------------------

export const AccountIdSchema = z.string().min(1);
export const GrantIdSchema = z.string().min(1);
export const PurchaseRefSchema = z.string().min(1);
/** Sortable period key (e.g. "2026-09"); renewal grants are keyed by paid period. */
export const PeriodKeySchema = z.string().regex(/^\d{4}-\d{2}$/);

export const GrantKindSchema = z.enum(["purchase", "renewal"]);
export type GrantKind = z.infer<typeof GrantKindSchema>;

export const RocheGrantSchema = z.strictObject({
  grantId: GrantIdSchema,
  account: AccountIdSchema,
  kind: GrantKindSchema,
  origin: RocheOriginSchema,
  purchaseRef: PurchaseRefSchema,
  amount: RocheUnitsSchema,
  remaining: RocheUnitsSchema,
  grantedAt: z.number().int().nonnegative(),
  /** Present on renewal grants: the paid period this grant is keyed to. */
  periodKey: PeriodKeySchema.optional(),
  /** Present on renewal grants: the subscription that paid for this period. */
  subscriptionId: z.string().min(1).optional(),
});
export type RocheGrant = z.infer<typeof RocheGrantSchema>;

export const CancelRecordSchema = z.strictObject({
  subscriptionId: z.string().min(1),
  account: AccountIdSchema,
  /** Grants stop after this paid period; paid-through benefit is retained. */
  paidThroughPeriodKey: PeriodKeySchema,
  cancelledAt: z.number().int().nonnegative(),
});
export type CancelRecord = z.infer<typeof CancelRecordSchema>;

/** §21.6 typed event table. Closed discriminated union (SC1). */
export const LifecycleEventSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("purchase"),
    grantId: GrantIdSchema,
    account: AccountIdSchema,
    origin: RocheOriginSchema,
    purchaseRef: PurchaseRefSchema,
    units: RocheUnitsSchema,
    at: z.number().int().nonnegative(),
  }),
  z.strictObject({
    type: z.literal("renewal-grant"),
    grantId: GrantIdSchema,
    account: AccountIdSchema,
    origin: RocheOriginSchema,
    subscriptionId: z.string().min(1),
    purchaseRef: PurchaseRefSchema,
    periodKey: PeriodKeySchema,
    units: RocheUnitsSchema,
    at: z.number().int().nonnegative(),
  }),
  z.strictObject({
    type: z.literal("cancel"),
    account: AccountIdSchema,
    subscriptionId: z.string().min(1),
    paidThroughPeriodKey: PeriodKeySchema,
    at: z.number().int().nonnegative(),
  }),
  z.strictObject({
    type: z.literal("refund"),
    grantId: GrantIdSchema,
    account: AccountIdSchema,
    reason: z.string().min(1),
    at: z.number().int().nonnegative(),
  }),
  z.strictObject({
    type: z.literal("restore"),
    account: AccountIdSchema,
    at: z.number().int().nonnegative(),
  }),
  z.strictObject({
    type: z.literal("spend"),
    account: AccountIdSchema,
    pool: RochePoolSchema,
    units: RocheUnitsSchema,
    at: z.number().int().nonnegative(),
  }),
]);
export type LifecycleEvent = z.infer<typeof LifecycleEventSchema>;

export class RocheLifecycleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RocheLifecycleError";
  }
}

export class RocheInsufficientError extends RocheLifecycleError {
  constructor(account: string, requested: number, available: number) {
    super(`${account}: spend of ${requested} exceeds available ${available}`);
    this.name = "RocheInsufficientError";
  }
}

/** Immutable ledger state; every event produces a fresh state (pure). */
export interface GrantLedgerState {
  readonly grants: readonly RocheGrant[];
  readonly cancels: readonly CancelRecord[];
  readonly events: readonly LifecycleEvent[];
}

export const emptyLedgerState = (): GrantLedgerState => ({
  grants: [],
  cancels: [],
  events: [],
});

function balanceOfGrants(state: GrantLedgerState, account: string, pool: RochePool): number {
  let total = 0;
  for (const grant of state.grants) {
    if (grant.account === account && fungibilityOf(grant.origin).pool === pool) {
      total += grant.remaining;
    }
  }
  assertRocheUnits(total, `balance(${account}, ${pool})`);
  return total;
}

/** Rejects any grant that would mix restricted origins into a foreign pool. */
function assertGrantPoolPure(state: GrantLedgerState, origin: RocheOrigin): void {
  const pool = fungibilityOf(origin).pool;
  const cohabitants = new Set<RocheOrigin>();
  for (const grant of state.grants) {
    if (fungibilityOf(grant.origin).pool === pool) cohabitants.add(grant.origin);
  }
  cohabitants.add(origin);
  assertNoMixing([...cohabitants]);
}

/**
 * Apply one §21.6 lifecycle event to a ledger state. Pure: returns a new
 * state; throws on every violation (bounds, no-negative, double grant,
 * cancelled future periods, pool mixing).
 */
export function applyLifecycleEvent(
  state: GrantLedgerState,
  event: LifecycleEvent,
): GrantLedgerState {
  LifecycleEventSchema.parse(event);
  switch (event.type) {
    case "purchase": {
      if (state.grants.some((grant) => grant.grantId === event.grantId)) {
        throw new RocheLifecycleError(`grant ${event.grantId} already exists`);
      }
      if (
        state.grants.some(
          (grant) => grant.kind === "purchase" && grant.purchaseRef === event.purchaseRef,
        )
      ) {
        throw new RocheLifecycleError(
          `purchase ${event.purchaseRef} already granted — replay-safe, no double grants`,
        );
      }
      assertGrantPoolPure(state, event.origin);
      const grant: RocheGrant = {
        grantId: event.grantId,
        account: event.account,
        kind: "purchase",
        origin: event.origin,
        purchaseRef: event.purchaseRef,
        amount: event.units,
        remaining: event.units,
        grantedAt: event.at,
      };
      return { ...state, grants: [...state.grants, grant], events: [...state.events, event] };
    }
    case "renewal-grant": {
      if (state.grants.some((grant) => grant.grantId === event.grantId)) {
        throw new RocheLifecycleError(`grant ${event.grantId} already exists`);
      }
      if (
        state.grants.some(
          (grant) =>
            grant.kind === "renewal" &&
            grant.subscriptionId === event.subscriptionId &&
            grant.periodKey === event.periodKey,
        )
      ) {
        throw new RocheLifecycleError(
          `subscription ${event.subscriptionId} period ${event.periodKey} already granted — one grant per paid period`,
        );
      }
      const cancel = state.cancels.find((entry) => entry.subscriptionId === event.subscriptionId);
      if (cancel && event.periodKey > cancel.paidThroughPeriodKey) {
        throw new RocheLifecycleError(
          `subscription ${event.subscriptionId} cancelled: no grants past paid-through ${cancel.paidThroughPeriodKey}`,
        );
      }
      assertGrantPoolPure(state, event.origin);
      const grant: RocheGrant = {
        grantId: event.grantId,
        account: event.account,
        kind: "renewal",
        origin: event.origin,
        purchaseRef: event.purchaseRef,
        amount: event.units,
        remaining: event.units,
        grantedAt: event.at,
        periodKey: event.periodKey,
        subscriptionId: event.subscriptionId,
      };
      return { ...state, grants: [...state.grants, grant], events: [...state.events, event] };
    }
    case "cancel": {
      // Stops future grants; already-paid benefit stays untouched (§21.6).
      const cancel: CancelRecord = {
        subscriptionId: event.subscriptionId,
        account: event.account,
        paidThroughPeriodKey: event.paidThroughPeriodKey,
        cancelledAt: event.at,
      };
      return { ...state, cancels: [...state.cancels, cancel], events: [...state.events, event] };
    }
    case "refund": {
      // Revokes ONLY that purchase's benefit; other grants preserved (§21.6).
      const grant = state.grants.find((entry) => entry.grantId === event.grantId);
      if (!grant) throw new RocheLifecycleError(`unknown grant ${event.grantId}`);
      if (grant.account !== event.account) {
        throw new RocheLifecycleError(`grant ${event.grantId} belongs to another account`);
      }
      return {
        ...state,
        grants: state.grants.filter((entry) => entry.grantId !== event.grantId),
        events: [...state.events, event],
      };
    }
    case "restore": {
      // Reconcile only: never re-issues initial credits (§21.6). Recorded for
      // provenance; grants and balance are untouched.
      return { ...state, events: [...state.events, event] };
    }
    case "spend": {
      // FIFO deduction across the grants of the target pool; never below zero.
      const available = balanceOfGrants(state, event.account, event.pool);
      if (event.units > available) {
        throw new RocheInsufficientError(event.account, event.units, available);
      }
      let toDeduct = event.units;
      const grants = state.grants.map((grant) => {
        const inPool =
          grant.account === event.account && fungibilityOf(grant.origin).pool === event.pool;
        if (!inPool || toDeduct === 0) return grant;
        const take = Math.min(grant.remaining, toDeduct);
        toDeduct -= take;
        return { ...grant, remaining: grant.remaining - take };
      });
      return { ...state, grants, events: [...state.events, event] };
    }
  }
}

/**
 * In-memory GrantLedger over the pure event applier. This is the seam:
 * persistence is another task's Owns. It is itself a `RocheBalanceSource`
 * (the system-of-record view of these grants); the application service must
 * read balances through that interface, never by summing grants itself.
 */
export class InMemoryGrantLedger implements RocheBalanceSource {
  private state: GrantLedgerState = emptyLedgerState();

  constructor(initial: GrantLedgerState = emptyLedgerState()) {
    this.state = initial;
  }

  /** Read boundary required of the service (§21.3 authority split). */
  balanceOf(account: string, pool: RochePool): number {
    return balanceOfGrants(this.state, account, pool);
  }

  apply(event: LifecycleEvent): GrantLedgerState {
    this.state = applyLifecycleEvent(this.state, event);
    return this.state;
  }

  get snapshot(): GrantLedgerState {
    return this.state;
  }

  grantsFor(account: string): readonly RocheGrant[] {
    return this.state.grants.filter((grant) => grant.account === account);
  }

  eventsFor(account: string): readonly LifecycleEvent[] {
    return this.state.events.filter((event) => "account" in event && event.account === account);
  }
}
