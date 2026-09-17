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
    const a = new URL(n, e), r = a.pathname.replace(/\/+$/, "");
    return t.origin === a.origin && (t.pathname === r || t.pathname.startsWith(`${r}/`));
  } catch {
    return !0;
  }
}
function f(t, n) {
  if (t.method !== "GET") return o.nonGet;
  const e = new URL(t.url), a = new URL(n.scope);
  if (h(e, n.mirror, a)) return o.mirror;
  if (h(e, n.bridge, a)) return o.bridge;
  if (e.origin !== a.origin || !/^https?:$/.test(e.protocol) || e.search || t.headers.has("authorization") || t.headers.has("range") || t.cache === "no-store" || t.mode === "navigate")
    return o.default;
  const r = a.pathname.replace(/\/?$/, "/");
  if (!e.pathname.startsWith(r)) return o.default;
  const c = e.pathname.slice(r.length);
  return c.includes("%") ? o.default : /^assets\/(?:[^/]+\/)*[^/]+[-.][A-Za-z0-9_-]{8,}\.[A-Za-z0-9.]+$/.test(c) ? o.hashedAssets : /^fonts\/(?:[^/]+\/)*[^/]+\.(?:woff2?|ttf|otf)$/i.test(c) ? o.fonts : o.default;
}
async function d(t, n, e) {
  if (f(t, n) === "network-only")
    return e.fetch(new Request(t, { cache: "no-store" }));
  let a;
  try {
    a = await e.caches.open(e.cacheName);
    const i = await a.match(t);
    if (i) return i;
  } catch {
    return e.fetch(t);
  }
  const r = await e.fetch(t), c = r.headers.get("cache-control") ?? "";
  if (r.ok && r.status === 200 && !r.redirected && r.type !== "opaque" && !/(?:^|,)\s*(?:no-store|private|no-cache)\b/i.test(c) && r.headers.get("vary") !== "*")
    try {
      await a.put(t, r.clone());
    } catch {
    }
  return r;
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
    cacheName: "mba.robin.natally-static-v1.29.27910-2026-09-17T19-51-25-787Z-aeca6066"
  };
  t.addEventListener("fetch", (a) => {
    a.respondWith(d(a.request, n, e));
  });
}
export {
  d as handleRequest,
  f as strategyFor,
  o as strategyMap
};
