const o = Object.freeze({
  hashedAssets: "cache-first",
  fonts: "cache-first",
  mirror: "network-only",
  bridge: "network-only",
  nonGet: "network-only",
  default: "network-only"
});
function h(t, a, e) {
  if (!a) return !1;
  try {
    const r = new URL(a, e), n = r.pathname.replace(/\/+$/, "");
    return t.origin === r.origin && (t.pathname === n || t.pathname.startsWith(`${n}/`));
  } catch {
    return !0;
  }
}
function f(t, a) {
  if (t.method !== "GET") return o.nonGet;
  const e = new URL(t.url), r = new URL(a.scope);
  if (h(e, a.mirror, r)) return o.mirror;
  if (h(e, a.bridge, r)) return o.bridge;
  if (e.origin !== r.origin || !/^https?:$/.test(e.protocol) || e.search || t.headers.has("authorization") || t.headers.has("range") || t.cache === "no-store" || t.mode === "navigate")
    return o.default;
  const n = r.pathname.replace(/\/?$/, "/");
  if (!e.pathname.startsWith(n)) return o.default;
  const c = e.pathname.slice(n.length);
  return c.includes("%") ? o.default : /^assets\/(?:[^/]+\/)*[^/]+[-.][A-Za-z0-9_-]{8,}\.[A-Za-z0-9.]+$/.test(c) ? o.hashedAssets : /^fonts\/(?:[^/]+\/)*[^/]+\.(?:woff2?|ttf|otf)$/i.test(c) ? o.fonts : o.default;
}
async function d(t, a, e) {
  if (f(t, a) === "network-only")
    return e.fetch(new Request(t, { cache: "no-store" }));
  let r;
  try {
    r = await e.caches.open(e.cacheName);
    const i = await r.match(t);
    if (i) return i;
  } catch {
    return e.fetch(t);
  }
  const n = await e.fetch(t), c = n.headers.get("cache-control") ?? "";
  if (n.ok && n.status === 200 && !n.redirected && n.type !== "opaque" && !/(?:^|,)\s*(?:no-store|private|no-cache)\b/i.test(c) && n.headers.get("vary") !== "*")
    try {
      await r.put(t, n.clone());
    } catch {
    }
  return n;
}
const s = globalThis;
if (s.registration && s.caches && s.fetch && s.addEventListener) {
  const t = s, a = {
    scope: t.registration.scope,
    mirror: "https://huggingface.co/RobinsAIWorld/natally-models/resolve/main",
    bridge: ""
  }, e = {
    caches: t.caches,
    fetch: t.fetch.bind(t),
    cacheName: "mba.robin.natally-static-v1.19.27226-2026-09-17T08-26-42-828Z-c5b1682b"
  };
  t.addEventListener("fetch", (r) => {
    r.respondWith(d(r.request, a, e));
  });
}
export {
  d as handleRequest,
  f as strategyFor,
  o as strategyMap
};
