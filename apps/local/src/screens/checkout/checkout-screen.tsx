// natally — the checkout screen (U.6, SCREEN.md screen-checkout, normative;
// J10). The handoff surface while a purchase is in flight, or the manual
// unlock: TopBar (context chip "Checkout") · Stage · her aside · state body ·
// one action. Six frozen variants: handoff (real QR from the real session URL
// via the `qrcode` dep + link line + "Open the page again" + license-key
// note) · iap-waiting (store sheet / RC paywall presented; Cancel) · success
// ("Unlocked. Unlimited from here —"; gilt "Back to our conversation") ·
// failure (ember-stroked reason card `[reason · runtime]`; Try again) ·
// offline (honest absence card "No connection"; Try again) ·
// enter-license-key (B.4 redeem on the NATALLY-… key shape).
//
// STATES law note: the Stage here mounts on the real C.4 bus only. The
// SCREEN.md sketch "(Thinking while waiting)" describes the covered screen on
// a device leg; this leg fabricates no thinking event — an in-flight checkout
// is not companion inference (STATES.md: states are driven only by real
// events). Success publishes `unlock` once per entry — the mascot's Delighted
// moment (§10), the only celebration.
//
// All deps are injected (structural shapes in ./types.ts); the wiring (I.1)
// binds the B.5a/B.5b rails, the poll and the license verify.

import QRCode from "qrcode";
import { type FormEvent, type ReactElement, useEffect, useRef, useState } from "react";
import { Button, Chip, TopBar, TurnHer } from "../../ui/primitives";
import { Stage } from "../../ui/stage";
import { redeemReason } from "../paywall/types";
import { type CheckoutScreenProps, deriveCheckoutVariant } from "./types";

// ---------------------------------------------------------------------------
// Frozen type ramp fragments (TOKENS.md text styles)
// ---------------------------------------------------------------------------

const MONO_MICRO = [
  "font-[family-name:'IBM_Plex_Mono',ui-monospace,monospace]",
  "text-[12px] leading-[16px]",
].join(" ");
const CARD = [
  "flex flex-col gap-3 rounded-[var(--radius-plate)]",
  "border-[length:var(--stroke-hairline)] border-[color:var(--color-hairline)]",
  "bg-[var(--color-midnight-2)] p-4",
].join(" ");
const EMBER_CARD = [
  "flex flex-col gap-2 rounded-[var(--radius-plate)]",
  "border-[length:var(--stroke-hairline)] border-[color:var(--color-ember)]",
  "bg-[var(--color-midnight-2)] p-4",
].join(" ");

// ---------------------------------------------------------------------------
// The real QR (U.6 mandate): rendered from the REAL checkout session URL via
// the owned `qrcode` dependency (pure-JS encoder, SVG string — jsdom/tsx-safe;
// no canvas, no network). The link line stands on its own if the encoder
// cannot (honest absence, never a fake block).
// ---------------------------------------------------------------------------

type QrState =
  | { readonly state: "pending" }
  | { readonly state: "ready"; readonly svg: string }
  | { readonly state: "unavailable" };

function CheckoutQr({ url }: { readonly url: string }): ReactElement {
  const [qr, setQr] = useState<QrState>({ state: "pending" });
  useEffect(() => {
    let active = true;
    setQr({ state: "pending" });
    QRCode.toString(url, { type: "svg", margin: 0 })
      .then((svg) => {
        if (active) {
          setQr({ state: "ready", svg });
        }
      })
      .catch(() => {
        if (active) {
          setQr({ state: "unavailable" });
        }
      });
    return () => {
      active = false;
    };
  }, [url]);

  if (qr.state === "ready") {
    return (
      <div
        data-testid="checkout-qr"
        data-state="ready"
        data-qr-of={url}
        className="w-fit bg-[var(--color-vellum)] p-2 [&>svg]:h-[176px] [&>svg]:w-[176px]"
        dangerouslySetInnerHTML={{ __html: qr.svg }}
      />
    );
  }
  return (
    <div
      data-testid="checkout-qr"
      data-state={qr.state}
      data-qr-of={url}
      className="flex h-[192px] w-[192px] items-center justify-center border-[length:var(--stroke-hairline)] border-[color:var(--color-hairline)] bg-[var(--color-midnight-2)]"
    >
      <span className={`m-0 ${MONO_MICRO} text-[var(--color-vellum-muted)]`}>
        {qr.state === "pending" ? "[qr · rendering · runtime]" : "[qr · unavailable · runtime]"}
      </span>
    </div>
  );
}

/** Her aside, per variant — authored in her voice, warm, no pressure. */
function asideFor(variant: ReturnType<typeof deriveCheckoutVariant>, rcPresented: boolean): string {
  switch (variant) {
    case "handoff":
      return "The checkout page is open — scan the code or follow the link. I'll keep your place.";
    case "iap-waiting":
      return rcPresented
        ? "The RevenueCat paywall is up — take your time."
        : "The store sheet is up — take your time.";
    case "success":
      return "Unlocked. Unlimited from here —";
    case "failure":
      return "Something went sideways with the checkout — here is what happened.";
    case "offline":
      return "We need the internet once to open the checkout — it will wait for you.";
    case "enter-license-key":
      return "A license key unlocks everything — no window to catch, no clock.";
  }
}

// ---------------------------------------------------------------------------
// The screen
// ---------------------------------------------------------------------------

export function CheckoutScreen({
  session,
  offline,
  outcome,
  keyEntry,
  bus,
  onRetry,
  onCancel,
  onOpenCheckout,
  onUnlock,
  onToggleKeyEntry,
  redeemKey,
  onUnlocked,
  layout = "mobile",
}: CheckoutScreenProps): ReactElement {
  const [keyValue, setKeyValue] = useState("");
  const [keyEmber, setKeyEmber] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  const variant = deriveCheckoutVariant({ offline, keyEntry, outcome, session });
  const rcPresented = session?.kind === "rc";
  const aside = asideFor(variant, rcPresented);

  // Delighted on success via the bus — exactly once per entry into success.
  const publishedRef = useRef(false);
  useEffect(() => {
    if (outcome.kind === "success") {
      if (!publishedRef.current) {
        publishedRef.current = true;
        bus.publish({ type: "unlock" });
      }
    } else {
      publishedRef.current = false;
    }
  }, [outcome.kind, bus]);

  /** The license-key entry path (§9.4): B.4 redeem on the NATALLY-… shape. */
  async function unlockWithKey(event: FormEvent): Promise<void> {
    event.preventDefault();
    const key = keyValue.trim();
    if (key.length === 0 || working) {
      return;
    }
    setWorking(true);
    try {
      const result = await redeemKey(key);
      if (result.outcome === "valid") {
        bus.publish({ type: "unlock" }); // Delighted (§10)
        onUnlocked?.();
      } else {
        setKeyEmber(redeemReason(result));
      }
    } finally {
      setWorking(false);
    }
  }

  const waitingLine =
    session?.kind === "rc"
      ? "[RevenueCat paywall presented · runtime]"
      : session?.kind === "iap"
        ? "[store sheet presented · runtime]"
        : "[checkout · in flight · runtime]";

  return (
    <div
      data-screen="checkout"
      data-variant={variant}
      data-layout={layout}
      className="mx-auto flex w-full max-w-[430px] flex-col gap-4 px-4 pb-16 pt-4"
    >
      <TopBar chip={<Chip data-testid="checkout-chip">Checkout</Chip>} />
      <Stage bus={bus} />

      <TurnHer name="natally">{aside}</TurnHer>

      {variant === "handoff" && (
        <>
          {session?.url === undefined || session?.url === "" ? (
            <p
              data-testid="checkout-link"
              data-absence="url-absent"
              className={`m-0 ${MONO_MICRO} text-[var(--color-vellum-muted)]`}
            >
              [checkout link · unavailable · runtime]
            </p>
          ) : (
            <>
              <CheckoutQr url={session.url} />
              <p
                data-testid="checkout-link"
                data-provenance="computed"
                className={`m-0 break-all ${MONO_MICRO} text-[var(--color-vellum-muted)]`}
              >
                [checkout link · {session.url} · runtime]
              </p>
            </>
          )}
          <Button data-testid="checkout-open-again" onClick={onOpenCheckout}>
            Open the page again
          </Button>
          <p className="m-0 text-[14px] leading-[20px] text-[var(--color-vellum-muted)]">
            On this device a license key unlocks without a browser.
          </p>
          <Button
            data-testid="checkout-key-note"
            variant="quiet"
            onClick={() => {
              onToggleKeyEntry(true);
            }}
          >
            Enter a license key
          </Button>
        </>
      )}

      {variant === "iap-waiting" && (
        <>
          <p
            data-testid="checkout-waiting"
            data-provenance="computed"
            className={`m-0 ${MONO_MICRO} text-[var(--color-vellum-muted)]`}
          >
            {waitingLine}
          </p>
          <Button data-testid="checkout-cancel" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        </>
      )}

      {variant === "success" && (
        <Button data-testid="checkout-back-conversation" onClick={onUnlock}>
          Back to our conversation
        </Button>
      )}

      {variant === "failure" && (
        <>
          <div className={EMBER_CARD}>
            <p
              data-testid="checkout-reason"
              data-reason={outcome.kind === "failure" ? outcome.reason : undefined}
              className={`m-0 ${MONO_MICRO} text-[var(--color-ember)]`}
            >
              [{outcome.kind === "failure" ? outcome.reason : ""} · runtime]
            </p>
          </div>
          <Button data-testid="checkout-try-again" onClick={onRetry}>
            Try again
          </Button>
        </>
      )}

      {variant === "offline" && (
        <>
          {(() => {
            // The honest-absence frame carries the real reason: no network,
            // or (contract breach) nothing actually in flight.
            const title = offline ? "No connection" : "Nothing in flight";
            const line = offline
              ? "Checkout needs the internet once."
              : "No checkout is open right now.";
            const absence = offline ? "offline" : "no-session";
            return (
              <div className={CARD} data-absence={absence}>
                <h3 className="m-0 font-[family-name:'Fraunces',serif] text-[18px] leading-[24px] font-semibold text-[var(--color-vellum)]">
                  {title}
                </h3>
                <p className="m-0 text-[14px] leading-[20px] text-[var(--color-vellum-muted)]">
                  {line}
                </p>
              </div>
            );
          })()}
          <Button data-testid="checkout-try-again" onClick={onRetry}>
            Try again
          </Button>
        </>
      )}

      {variant === "enter-license-key" && (
        <form onSubmit={unlockWithKey} className="flex flex-col gap-2">
          <div className={CARD}>
            <input
              data-testid="checkout-key-input"
              value={keyValue}
              onChange={(event) => {
                setKeyValue(event.target.value);
                setKeyEmber(null); // an edited key is no longer the judged one
              }}
              placeholder="[license key · runtime]"
              aria-label="License key"
              className="w-full rounded-[var(--radius-button)] border-[length:var(--stroke-hairline)] border-[color:var(--color-hairline)] bg-[var(--color-midnight)] px-3 py-2 font-[family-name:'IBM_Plex_Mono',ui-monospace,monospace] text-[14px] leading-[20px] text-[var(--color-vellum)] focus-visible:outline focus-visible:outline-[color:var(--color-orbglow)]"
            />
            <p className="m-0 text-[14px] leading-[20px] text-[var(--color-vellum-muted)]">
              Keys look like NATALLY-XXXX-XXXX-XXXX.
            </p>
            {keyEmber !== null && (
              <p
                data-testid="checkout-key-ember"
                data-reason={keyEmber}
                className={`m-0 ${MONO_MICRO} text-[var(--color-ember)]`}
              >
                [{keyEmber} · runtime]
              </p>
            )}
            <Button data-testid="checkout-key-submit" type="submit" disabled={working}>
              Unlock with key
            </Button>
          </div>
          <Button
            data-testid="checkout-key-back"
            variant="quiet"
            onClick={() => {
              onToggleKeyEntry(false);
            }}
          >
            Back to the checkout
          </Button>
        </form>
      )}
    </div>
  );
}
