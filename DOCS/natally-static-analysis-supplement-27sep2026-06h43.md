# Natally static analysis supplement — 27 September 2026

Reviewed source: `3eebd98`, version `1.34.33290`, canonical CascadeProjects checkout.
During this review, concurrent documentation commit `433c7a5` added
`ANALYSIS-REPORT-2026-09-27-v1.34.33290.md`; its diff changes no source. That report
is preserved. This supplement records independently traced findings and additional
API, persistence, and performance evidence rather than overwriting concurrent work.

Scope: static quality, security, performance and architecture review, using the
invoked source-command-sc-analyze skill. No application, tests, compilation,
dependency audit, device checks, source fixes, or checklist marker changes were
performed. Severity and impact below follow source control flow; they are not
claims of observed production incidents or successful exploit demonstrations.

## Highest-priority additional finding: incompatible bridge API contracts (P1)

The client and server cannot complete the same checkout/redemption exchange:

| Operation | Client contract | Mounted bridge contract |
| --- | --- | --- |
| POST /verify | `{appUserId}`, expects `{token, denyList?}` | `{token}`, returns `{valid, payload? / reason?}` |
| POST /redeem | `{code}`, expects `{valid: boolean, token?, reason?}` | `{code}`, returns `{result: valid/invalid/already-used/expired, ...}` |

Evidence:

- `packages/billing/src/bridge-client.ts:70-84`: verifyOnce posts appUserId and rejects a response without a token member.
- `packages/billing/src/bridge-client.ts:87-104`: redeemOnce requires a boolean valid member.
- `services/license-bridge/src/token.rs:121-133`: VerifyRequest requires token; its handler returns validation, not token acquisition.
- `services/license-bridge/src/codes.rs:108-135`: redemption persists its first result and returns the tagged result shape, without a token.
- `services/license-bridge/src/main.rs:31-38`: these exact handlers are mounted at the public paths.

Consequences inferred from source: checkout polling cannot acquire its license
from this router. A valid redemption is consumed server-side before the client
rejects the response as malformed; repeating it then returns already-used.
The bridge tests exercise token verification and direct redemption separately,
which does not establish compatibility with the TypeScript client.

Recommendation: specify one shared acquisition/verification/redemption protocol,
including authenticated ownership and retry semantics. Keep token validation and
post-checkout acquisition distinct unless the approved contract explicitly unifies
them. Add a real client-to-router contract check that proves purchase to token
acquisition, valid redemption to usable entitlement, and recovery after a lost
response. Reconcile B.5a/B.6 ownership before implementation.

## Independently confirmed critical integration and durability findings

1. **P1 — production trial gate uses constant inputs.**
   `apps/local/src/composition.ts:155-174` passes an empty ledger and false license
   state to evaluateGate. `packages/billing/src/trial.ts:64-93` therefore sees all
   count allowance as remaining, no rate-limit history, and no install row for a
   time trial (which throws). Verified license state cannot become licensed in
   this path. Wire the existing ledger and verified entitlement controller, with
   checks across count/time/rate policies and application reload. This confirms
   F1 in the concurrent report; no completion marker was changed.

2. **P1 — companion prompts omit remembered lore.**
   `apps/local/src/composition.ts:482-544` saves transcript turns but calls the
   inference engine with `memory: []` and `toolResults: []` at lines 499-504.
   Transcript display is not prompt retrieval. The route at
   `apps/local/src/screens/conversation/route.tsx:18-25` consumes this composition.
   Integrate the approved retrieval/extraction/tool lifecycle and verify recall
   of an earlier fact in a subsequent turn and after restart. This confirms the
   composed-path gap described in F4; it does not deny that lore modules exist.

3. **P1 — webhook outcomes are not crash-atomic.**
   `services/license-bridge/src/webhooks.rs:95-106` writes minted_jti separately
   from its replay ledger. Lines 141-155 similarly write revocation before the
   replay outcome. `services/license-bridge/src/db.rs:29-41` enforces unique
   purchase identity and revocation primary keys. Interruption between writes
   leaves a retry reaching the duplicate insert and its expect panic; panicking
   while holding the shared mutex also poisons subsequent lock attempts in that
   process. Use one transaction per state transition and durable replay result,
   with interruption/retry verification at each write boundary. This confirms F5.

4. **P2 — redeem-code output has 60 bits, not the claimed 128.**
   `services/license-bridge/src/codes.rs:21,49-70` samples 16 bytes but truncates
   output to 12 base-32 characters: 32^12 = 2^60 possible strings. Reconcile the
   fixed display format and entropy contract; retaining 128 random bits requires
   at least 26 base-32 characters before grouping. No practical brute-force
   attack was demonstrated. This confirms F10 and is a specification conflict,
   not permission to silently change the public code format.

## Additional persistence finding (P2)

`apps/local/src/composition.ts:200-214` catches every openWebDatabase failure
without surfacing a status, then leaves all repositories null. Lines 484-486 and
538-540 accept turns into memory only. The catch covers database/open/migration
failures as well as expected lack of OPFS support. No persistence status is
returned in the composition at lines 562-590.

A user can continue a seemingly normal conversation whose new data disappears
on reload. Existing records are not proven deleted; the defect is silent loss of
durability for new work. Distinguish unsupported storage from database failures,
surface an explicit temporary-session state, and provide a recoverable path.
Verify with denied storage and a database initialization error, including reload.
The unguarded localStorage access at lines 103-108 is a separate limitation of
the purported storage-denied fallback: it can fail before the database catch.

## Performance finding requiring measurement (P2)

Model residency and prompt-cache reuse are distinct. The current composition
preloads an already-downloaded model (`composition.ts:405-408`) and retains the
engine. Nevertheless, `apps/local/src/companion/inference-web.ts:94-103` explicitly
sets cache_prompt false. The native backend at
`apps/local/src-tauri/src/inference/llama.rs:123-161` creates a fresh context and
decodes the full prompt for each completion.

Repeated factual/persona prefixes therefore cannot reuse this cross-turn cache
through these paths. The native fresh-context comment deliberately seeks fence
isolation; simply enabling reuse would not establish correctness. Profile
prompt-evaluation time separately from model loading and generation, then consider
prefix reuse with explicit invalidation on chart/persona/fence changes. No latency,
memory, throughput, or battery impact was measured; keep session model residency.

## Assessment and boundaries

The most consequential pattern is incomplete composition between implemented
modules. Prior isolated verification does not establish a usable purchase flow,
usage enforcement, companion memory, or crash recovery. Native capability/voice
selection, paywall screens, hosted behavior and release/device verification remain
explicitly open checklist work and are not newly discovered regressions here.

Recommended order: unify bridge contracts and atomic transitions; wire entitlement,
ledger and lore into production composition; make persistence failures visible;
resolve entropy specifications; measure prompt processing before optimization.
These are review recommendations, not a replacement tasklist or source changes.

Inventory query found 147 tracked TS/TSX/Rust files beneath src directories in
apps/packages/services (93 TS, 33 TSX, 21 Rust), including 22 conventionally named
test files. This deliberately excludes tests and native modules outside src and
is neither a coverage percentage nor a total repository code count. Checklist
currently has 27 validated bullet groups, two [X] groups and 29 open groups;
grouped task ranges prevent treating that as an individual task census. Its
52/2/36 preamble is a dated declaration, not a fresh audit metric.

Tooling limitations: Admin-Manual HTTPS refresh failed to connect after 133636 ms;
local authority revision 3046baa was used. The routed donor billing convention
was absent. CodeGraph initially reported zero pending file changes, but requested
an extraction-version reindex. The required helper launched that rebuild; its
completion was not yet verified when this report was written. CodeGraph provided
current source for the initial traces, then reported queue contention and later
an empty index during rebuild. Named targeted reads closed those specific gaps.
No healthy-bootstrap or release-readiness verdict is asserted.
