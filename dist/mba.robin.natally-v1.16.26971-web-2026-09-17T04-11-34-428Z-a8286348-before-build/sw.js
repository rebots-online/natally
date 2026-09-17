const o = Object.freeze({
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
  if (t.method !== "GET") return o.nonGet;
  const e = new URL(t.url), r = new URL(n.scope);
  if (h(e, n.mirror, r)) return o.mirror;
  if (h(e, n.bridge, r)) return o.bridge;
  if (e.origin !== r.origin || !/^https?:$/.test(e.protocol) || e.search || t.headers.has("authorization") || t.headers.has("range") || t.cache === "no-store" || t.mode === "navigate")
    return o.default;
  const a = r.pathname.replace(/\/?$/, "/");
  if (!e.pathname.startsWith(a)) return o.default;
  const c = e.pathname.slice(a.length);
  return c.includes("%") ? o.default : /^assets\/(?:[^/]+\/)*[^/]+[-.][A-Za-z0-9_-]{8,}\.[A-Za-z0-9.]+$/.test(c) ? o.hashedAssets : /^fonts\/(?:[^/]+\/)*[^/]+\.(?:woff2?|ttf|otf)$/i.test(c) ? o.fonts : o.default;
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
  const a = await e.fetch(t), c = a.headers.get("cache-control") ?? "";
  if (a.ok && a.status === 200 && !a.redirected && a.type !== "opaque" && !/(?:^|,)\s*(?:no-store|private|no-cache)\b/i.test(c) && a.headers.get("vary") !== "*")
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
    cacheName: "mba.robin.natally-static-v1.15.26963-2026-09-17T04-03-18-458Z-adee30cb"
  };
  t.addEventListener("fetch", (r) => {
    r.respondWith(d(r.request, n, e));
  });
}
export {
  d as handleRequest,
  f as strategyFor,
  o as strategyMap
};
