import {
  Component,
  type ComponentType,
  type LazyExoticComponent,
  lazy,
  type ReactNode,
  Suspense,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { TopBar } from "./primitives/TopBar";
import {
  getRegisteredRoute,
  getRegistryRevision,
  matchRoute,
  type RouteLoad,
  type RouteScreenProps,
  subscribeRoutes,
  useHashPath,
} from "./router";
import { VersionStamp } from "./version";
// The app entry point loads @natally/design-tokens/tokens.css through global.css.
import "./primitives/primitives.css";

const screens = new WeakMap<
  RouteLoad,
  {
    component: LazyExoticComponent<ComponentType<RouteScreenProps>>;
    id: number;
  }
>();
let nextScreenId = 0;
function screenFor(load: RouteLoad) {
  let screen = screens.get(load);
  if (!screen) {
    screen = { component: lazy(load), id: ++nextScreenId };
    screens.set(load, screen);
  }
  return screen;
}

class ScreenBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    return this.state.failed ? (
      <p className="ui-absence ui-absence--error" role="alert">
        This screen is unavailable.
      </p>
    ) : (
      this.props.children
    );
  }
}

const navigation = [
  { path: "/", label: "Conversation" },
  { path: "/people", label: "People" },
  { path: "/settings", label: "Settings" },
  { path: "/about", label: "About" },
] as const;

/** U.1 shell: one navigation system; screen modules join through registerRoute. */
export function NatallyShell() {
  const hash = useHashPath();
  useSyncExternalStore(subscribeRoutes, getRegistryRevision, getRegistryRevision);
  const match = matchRoute(hash);
  const registration = match ? getRegisteredRoute(match.path) : undefined;
  const selected = registration ? screenFor(registration.load) : undefined;
  const Screen = selected?.component;
  const [menuOpen, setMenuOpen] = useState(false);
  const navigationId = useId();
  const mainId = useId();
  const main = useRef<HTMLElement>(null);
  const previousHash = useRef<string | null>(null);

  useEffect(() => {
    if (previousHash.current === hash) return;
    previousHash.current = hash;
    setMenuOpen(false);
    main.current?.focus();
  }, [hash]);

  return (
    <div className="ui-shell" data-theme="dark">
      <a
        className="ui-skip-link"
        href={`#${mainId}`}
        onClick={(event) => {
          event.preventDefault();
          main.current?.focus();
        }}
      >
        Skip to content
      </a>
      <TopBar
        onMenu={() => setMenuOpen((open) => !open)}
        menuOpen={menuOpen}
        menuId={navigationId}
      />
      <div className="ui-shell__layout">
        <nav
          id={navigationId}
          className="ui-navigation"
          aria-label="Main"
          data-open={menuOpen}
          onKeyDown={(event) => {
            if (event.key === "Escape") setMenuOpen(false);
          }}
        >
          {navigation.map(({ path, label }) => (
            <a
              key={path}
              href={`#${path}`}
              onClick={() => setMenuOpen(false)}
              aria-current={
                match &&
                (match.pathname === path || (path === "/people" && match.path === "/people/:id"))
                  ? "page"
                  : undefined
              }
            >
              {label}
            </a>
          ))}
        </nav>
        <main id={mainId} ref={main} className="ui-shell__surface" tabIndex={-1}>
          <ScreenBoundary key={`${hash}:${selected?.id ?? "absent"}`}>
            <Suspense
              fallback={
                <p className="ui-absence" role="status">
                  Loading screen…
                </p>
              }
            >
              {Screen && match ? (
                <Screen {...match} />
              ) : (
                <p className="ui-absence" role="status">
                  {match
                    ? "No screen is registered for this route yet."
                    : "This route does not exist."}
                </p>
              )}
            </Suspense>
          </ScreenBoundary>
        </main>
      </div>
      <VersionStamp />
    </div>
  );
}

export default NatallyShell;
