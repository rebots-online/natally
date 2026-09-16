// natally — Shell (U.1). The one navigation system: renders the matched
// route's lazy screen over the midnight ground and stamps the version
// bottom-right on every surface (data/micro). Screens register themselves
// into the router registry from their own modules (registerRoute); I.1 later
// consolidates their import list. The shell never imports screens directly.
//
// Hash routing (ARCHITECTURE.md §3): `hashchange` is the only navigation
// event; Android back works for free. Unknown hash or a route with no
// registered screen renders honest absence (INC-19: labelled, faking nothing).

import {
  type ComponentType,
  type LazyExoticComponent,
  lazy,
  type ReactElement,
  Suspense,
  useSyncExternalStore,
} from "react";
import { matchRoute, type RouteLoader, type RouteScreenProps, routeRegistry } from "./router";
import { VersionStamp } from "./version";

function subscribeToHash(onChange: () => void): () => void {
  window.addEventListener("hashchange", onChange);
  return () => {
    window.removeEventListener("hashchange", onChange);
  };
}

function getHash(): string {
  return window.location.hash;
}

function getServerHash(): string {
  return "";
}

// One lazy component per loader — recreated per render would remount the
// screen on every hash change and re-suspend.
const LAZY_SCREENS: WeakMap<
  RouteLoader,
  LazyExoticComponent<ComponentType<RouteScreenProps>>
> = new WeakMap();

function lazyScreen(load: RouteLoader): LazyExoticComponent<ComponentType<RouteScreenProps>> {
  let screen = LAZY_SCREENS.get(load);
  if (screen === undefined) {
    screen = lazy(load);
    LAZY_SCREENS.set(load, screen);
  }
  return screen;
}

function RoutedScreen({
  load,
  params,
}: {
  readonly load: RouteLoader;
  readonly params: Readonly<Record<string, string>>;
}): ReactElement {
  const Screen = lazyScreen(load);
  return <Screen params={params} />;
}

function Absence({ reason }: { readonly reason: string }): ReactElement {
  return (
    <div className="natally-absence">
      {/* honest absence (INC-19): labelled, static, fakes no progress */}
      <p
        data-absence={reason}
        className="natally-wordmark m-0 font-[family-name:'Nunito_Sans',ui-sans-serif,sans-serif] text-[14px] leading-[20px] text-[var(--color-vellum-muted)]"
      >
        This page does not exist yet.
      </p>
    </div>
  );
}

export function Shell(): ReactElement {
  const hash = useSyncExternalStore(subscribeToHash, getHash, getServerHash);
  const match = matchRoute(hash);
  const definition = match === null ? undefined : routeRegistry().get(match.path);

  return (
    <div
      data-shell="true"
      className="relative flex min-h-dvh flex-col bg-[var(--color-midnight)] text-[var(--color-vellum)]"
    >
      <main className="flex flex-1 flex-col">
        {match === null || definition === undefined ? (
          <Absence reason={match === null ? "unrouted" : "unregistered"} />
        ) : (
          <Suspense fallback={null}>
            <RoutedScreen load={definition.load} params={match.params} />
          </Suspense>
        )}
      </main>
      <VersionStamp />
    </div>
  );
}
