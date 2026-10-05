const c = Object.freeze({
  hashedAssets: "cache-first",
  fonts: "cache-first",
  mirror: "network-only",
  bridge: "network-only",
  nonGet: "network-only",
  default: "network-only"
});
function h(t, n, e) {
  if (!n) return !1;
  try {
    const r = new URL(n, e), a = r.pathname.replace(/\/+$/, "");
    return t.origin === r.origin && (t.pathname === a || t.pathname.startsWith(`${a}/`));
  } catch {
    return !0;
  }
}
function f(t, n) {
  if (t.method !== "GET") return c.nonGet;
  const e = new URL(t.url), r = new URL(n.scope);
  if (h(e, n.mirror, r)) return c.mirror;
  if (h(e, n.bridge, r)) return c.bridge;
  if (e.origin !== r.origin || !/^https?:$/.test(e.protocol) || e.search || t.headers.has("authorization") || t.headers.has("range") || t.cache === "no-store" || t.mode === "navigate")
    return c.default;
  const a = r.pathname.replace(/\/?$/, "/");
  if (!e.pathname.startsWith(a)) return c.default;
  const o = e.pathname.slice(a.length);
  return o.includes("%") ? c.default : /^assets\/(?:[^/]+\/)*[^/]+[-.][A-Za-z0-9_-]{8,}\.[A-Za-z0-9.]+$/.test(o) ? c.hashedAssets : /^fonts\/(?:[^/]+\/)*[^/]+\.(?:woff2?|ttf|otf)$/i.test(o) ? c.fonts : c.default;
}
async function d(t, n, e) {
  if (f(t, n) === "network-only")
    return e.fetch(new Request(t, { cache: "no-store" }));
  let r;
  try {
    r = await e.caches.open(e.cacheName);
    const i = await r.match(t);
    if (i) return i;
  } catch {
    return e.fetch(t);
  }
  const a = await e.fetch(t), o = a.headers.get("cache-control") ?? "";
  if (a.ok && a.status === 200 && !a.redirected && a.type !== "opaque" && !/(?:^|,)\s*(?:no-store|private|no-cache)\b/i.test(o) && a.headers.get("vary") !== "*")
    try {
      await r.put(t, a.clone());
    } catch {
    }
  return a;
}
const s = globalThis;
if (s.registration && s.caches && s.fetch && s.addEventListener) {
  const t = s, n = {
    scope: t.registration.scope,
    mirror: "https://huggingface.co/RobinsAIWorld/natally-models/resolve/main",
    bridge: ""
  }, e = {
    caches: t.caches,
    fetch: t.fetch.bind(t),
    cacheName: "mba.robin.natally-static-v1.33.33267-2026-09-21T13-17-55-033Z-a0c55c17"
  };
  t.addEventListener("fetch", (r) => {
    r.respondWith(d(r.request, n, e));
  });
}
export {
  d as handleRequest,
  f as strategyFor,
  c as strategyMap
};
