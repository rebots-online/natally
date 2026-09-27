# natally: refreshed static analysis, 2026-09-27

## Scope and evidence

Canonical checkout: `/home/robin/CascadeProjects/natally`. Reviewed source revision:
`3eebd98`, branch `master`, source version `1.34.33290`. This report supersedes the
September 13 report for current prioritization; it does not certify a release.

The operator reports Forgejo down until further notice. No Forgejo fetch, push,
deployment, or infrastructure recovery was attempted. Local Admin-Manual revision
used: `3046baa`; remote freshness is unverified. The Desktop checkout was not used
as current implementation evidence.

Method: source-command-sc-analyze, static review of quality, security, performance,
and architecture, followed by mapping findings to the existing CHECKLIST.md.
Reviewed the production conversation composition, route registration and shell,
voice provisioning, billing gate, license bridge ingestion/persistence, native
lore IPC, hosted shell, gate configuration, and relevant contracts. This is a
cross-domain review of selected critical paths, not an assertion that every source
file or dependency was audited. No compilation, application execution, tests,
dependency installation, or source fixes were performed.

Evidence observed in this review:

| Surface | Observation |
| --- | --- |
| Latest source commit | `3eebd98`, dated 2026-09-21; message records a Surge CNAME and v1.33.33267 deployment |
| Initial worktree | Untracked `.codex/` and `DOCS/BUG-REPORTS/`; preserved and excluded from this review |
| Tracked source inventory | 126 `.ts`, 33 `.tsx`, 26 `.rs` files under apps/packages/services after excluding public, generated, asset and icon directories; includes tests |
| Tracked test files | 48 `*.test.*` files under apps/packages/services; not a current pass count |
| Release paths | 3,915 tracked paths under dist; presence is not artifact integrity or successful runtime evidence |
| Stitch v2 | Zero tracked paths under `LIBS/UI/STITCH-v2` |
| Static lint attempt | `./node_modules/.bin/biome check . --reporter=summary --max-diagnostics=30` exited 127: executable missing |
| Runtime/build/test verdict | Not run under this skill's static-analysis boundary |

CodeGraph initially reported an up-to-date index, but the bootstrap helper then
reported `CodeGraph database health failed: SQLite quick_check failed`. It preserved
a recovery snapshot at
`/home/robin/Admin-Manual/.staging/codegraph-recovery/20260927T103252.680442Z-4a26eda35a7c42128df272a50b30bae1/.codegraph`.
Initialization returned "Already initialized"; its repeated health probe was stopped
after remaining active, before allowing this review to expand into a full graph rebuild.
Recovery is incomplete. Another independently running helper was left untouched.
Graph relationship/coverage claims are therefore excluded. Findings below use
the tool's line-numbered, current on-disk source text and targeted file reads.
The complete continuity bootstrap cannot be certified healthy.

## Prioritized findings

Severity: P1 means a core behavior or integrity contract is broken on an identified
path; P2 means a significant integration, assurance, or boundary weakness. Impacts
are inferred from source unless specifically described as command observations.

### F1 / P1: production access control ignores the reading ledger and license state

Evidence: `apps/local/src/composition.ts:155`, particularly line 162, evaluates
`evaluateGate(config.trial, [], () => Date.now(), false)`. Its submit path at line
482 runs inference without the billing `consume` seam. By contrast,
`packages/billing/src/trial.ts:65` derives count trials from ledger length; line 74
requires exactly one installation row for time trials.

Consequences: count/rate trials cannot reflect accumulated usage, verified licenses
cannot produce the licensed state through this composition, and a configured time
trial throws during composition initialization. This is an integration defect even
if B.1/B.2/B.3 unit tests pass.

Recommendation: connect the production access controller and submit lifecycle to
the existing ledger, verified entitlement, charge and compensation contracts.
Owners: I.1 integration, B.1/B.2/B.3; reconcile their ownership before coding.

### F2 / P1: rejected factual output is displayed before fence validation

Evidence: `apps/local/src/composition.ts:517` emits each candidate token to the public
bus at line 521; `checkFence` runs only after completion at lines 527 and 533.
`apps/local/src/screens/conversation/use-conversation.ts:74` appends those tokens to
visible stream state, rendered by `ConversationScreen.tsx:420`.

A rejected first candidate is therefore visible before its rejection. Regeneration
adds more tokens to the same stream until the final turn event clears it. Returning
`FENCE_ABSENCE` at the end cannot undo the earlier disclosure.

Recommendation: keep candidate output private until the fence accepts it, using
the existing approved turn lifecycle. Owners: C.2 and I.1; U.2 is the display consumer.

### F3 / P1: voice provisioning cannot resolve any of the manifest assets

Evidence: `apps/local/src/composition.ts:434` strips the requested URL to a filename
and searches `entry.file === name`. All `file` values in
`apps/local/src/mirror/catalogue.json` are absolute HTTPS URLs. The requested model
alias is also `kokoro-v1-q8.onnx`, whereas the catalogue file is
`onnx/model_quantized.onnx`.

`apps/local/src/voice/web.ts:210` invokes that reader for model, tokenizer and voice.
Even after downloads succeed, lookup rejects with `Unknown mirror asset`.
`speakReply` at composition line 270 suppresses the failure, and `ensureVoice` retains
the rejected promise, preventing a normal retry within the session.

Recommendation: map the three provisioned manifest entries explicitly into the
reader; expose honest voice failure and clear failed initialization for retry.
Owners: V.2, MS.2 and I.1 integration.

### F4 / P1: conversation bypasses the completed lore/tool orchestration

Evidence: `apps/local/src/composition.ts:386` creates the web inference engine
directly. The prompt at lines 499-504 always supplies `memory: []` and
`toolResults: []`. The submit path writes transcript turns but does not invoke the
retrieval/extraction pipeline or execute the tool suite.

Implemented lore and tool modules do not provide those capabilities to this
production path. The current turn and chart reach the model, but recalled lore and
tool results do not. This limits the core companion regardless of isolated module
verification.

Recommendation: integrate the specified companion/lore lifecycle at the composition
boundary. Owners: I.1, C.1-C.4 and L.3-L.5.

### F5 / P1: webhook fulfillment and reversal are not crash-atomic

Evidence: `services/license-bridge/src/webhooks.rs:95` inserts `minted_jti` and then
`webhook_ledger` through separate operations without a transaction. Reversal likewise
inserts a revocation at line 141 before updating the ledger at line 150.
`services/license-bridge/src/db.rs:35` makes `(processor, invoice_id)` unique, and
line 40 makes revocation `jti` a primary key.

A crash after the first write leaves a partial result. Retrying fulfillment hits
the unique purchase constraint; retrying reversal hits the revocation primary key.
The `.expect(...)` calls panic while holding the shared database mutex, poisoning
subsequent lock attempts in that process. The in-process mutex does not provide
database crash recovery.

Recommendation: transactionally persist each purchase/reversal and its idempotency
outcome; make replay recoverable after interruption. Owner: B.6, currently marked ✅.

### F6 / P2: an early reversal permanently blocks a later fulfillment

Evidence: `services/license-bridge/src/webhooks.rs:148` produces
`no-fulfilled-purchase`, then stores it in the same `(processor, invoiceId)` ledger.
`process_fulfilled` at lines 85-94 returns any existing outcome without distinguishing
event type. An early reversal therefore makes a later fulfillment return that
earlier absence outcome indefinitely.

Recommendation: specify event ordering and preserve a durable reversal tombstone
with explicit purchase state; do not simply ignore reversals or replay an unrelated
event's result. Owner: B.6. The intended treatment of a reversed-before-fulfilled
purchase needs an explicit contract, not an accidental state transition.

### F7 / P2: completed About screen is unreachable; route regeneration rejects it

Evidence: `apps/local/src/ui/routes.generated.ts:4` registers only `/`.
`apps/local/src/ui/shell.tsx:70` advertises People, Settings and About.
`apps/local/scripts/gen-routes.mjs:15` maps only conversation, and lines 35-38 reject
every discovered route file without a mapping. About and Splash have tracked
`route.tsx` files. About's adapter explicitly documents its missing registration
at `apps/local/src/screens/about/route.tsx:5`.

The About navigation reaches the shell's absence state despite U.7 being marked ✅.
The generator cannot bring the current route adapters into agreement. Other absent
screens are already pending work, not newly discovered regressions.

Recommendation: reconcile approved route/lifecycle mappings and generated output,
then validate navigation to each completed screen. Owners: I.1, U.7/U.8 and W3 wiring.

### F8 / P2: native artifacts still enter web-only composition

Evidence: the shared entry imports the route registry in `apps/local/src/app.tsx:4`.
Conversation uses `createConversationComposition`, which directly selects
`openWebDatabase`, `WebMirrorStorage`, `createWebInferenceEngine` and
`createKokoroWebVoice`. Tracked native plugin entrypoints are ephemeris and lore.
The production Tauri CSP permits self/IPC connections, not public model downloads.

Thus packaging native artifacts does not establish native inference/voice/storage
behavior. The active path is inconsistent with the installed-app native-voice
contract; browser download/runtime paths also face the native CSP restrictions.
No device failure was executed or measured in this review.

Recommendation: complete V.1, I.2 and I.3 and their specified composition integration,
then perform W7-4. These tasks are already open; preserve that distinction.

### F9 / P2: lore IPC accepts unrestricted renderer-provided SQL

Evidence: `packages/lore/native/lore_commands.rs:198` executes supplied migration
SQL and line 264 prepares supplied statement SQL. There is no SQL authorizer in
that connection path. The lore plugin is mounted and its main-window capability
grants `lore_open`, `lore_batch`, and `lore_close`.

This exposes broad native database authority to a compromised authorized renderer,
including schema/data alteration. Cross-file effects such as ATTACH depend on the
actual SQLite/runtime configuration and were not demonstrated. This is a boundary
weakness, not a demonstrated remote exploit.

Recommendation: define the necessary SQL authority, restrict it, and bound request
and result sizes. Owner: L.1 with I.2 capability integration. The same synchronous
commands hold a shared mutex while collecting complete results, creating an
unbounded blocking/allocation risk. No UI-freeze duration is claimed.

### F10 / P2: code entropy is 60 bits while the contract claims 128

Evidence: `services/license-bridge/src/codes.rs:21` limits generated bodies to 12
Crockford base32 characters. Lines 56-69 stop after those characters even though
16 random bytes were sampled. The output space is at most 32^12 = 2^60.

Recommendation: reconcile the public code format and entropy requirement in the
specification, then implement the approved choice. A longer random input cannot
increase the entropy of this fixed output. Owners: B.4/B.6; specification decision
required. No practical brute-force exploit is claimed.

### F11 / P2: aggregate verification omits declared coverage and budget checks

Evidence: `scripts/check.sh:6` runs recursive typecheck/lint and Vitest with two
workers. It contains neither a bundle-budget check nor a Rust service test command.
`vitest.workspace.ts:4` discovers only apps and packages, excluding the root
`scripts/__tests__/gen-appx-manifest.test.mjs`. The root script retains
`--passWithNoTests`.

Consequently a green aggregate run would not establish I.4's built-artifact JS
budget or B.6's Rust checks, and would not exercise the root packaging test file.
I.4 remains open; this report does not allege a current failing test run.

Recommendation: explicitly reconcile the intended aggregate gate with the owned
task checks and built-artifact budget. Owners: I.4, R.7 and WP.2.

## Additional architecture and performance observations

- H.1 is ✅, but `apps/hosted/src/app.tsx:1` explicitly shares design tokens only;
  it renders a service-interface inventory rather than the same exported UI shell
  required by H.1's Accept clause. Service seams can be complete while shared UI
  acceptance remains unmet. W3-S2 is pending and no Stitch-v2 paths are tracked.
- OR.4 owns a "server-side module in the license bridge or hosted service" rather
  than one exact file/interface. W3-Screens overlaps the per-screen Owns sets.
  These contradict the checklist's self-contained, disjoint-ownership claims and
  should be resolved at architecture/checklist signoff.
- Numerous task acceptance clauses require live browser/device observations,
  while the execution protocol claims durable idempotent acceptance. Separate
  repeatable task assertions from operator verification protocols; U.4-TW already
  demonstrates that split.
- Model source drift: architecture §13 names the MiniLM source as `gpustack`, but
  the current catalogue uses `leliuga`. Reconcile the decision record and frozen
  source table; this review did not fetch or re-hash external weights.
- Each token updates React stream state; `ConversationScreen.tsx:259` reconstructs
  and sorts transcript items on render. This creates avoidable history-dependent
  work. Profile before assigning latency or severity beyond this static concern.
- Lore IPC collects results without row/byte bounds and serializes operations with
  one mutex. Move expensive native work to the specified off-thread boundary and
  establish limits when its owning task is amended.
- Cached source/built-version differences are not automatically defects: the
  checklist explicitly requires a post-build source-version bump. v1.34 source
  alongside recorded v1.33 artifacts can be intentional.

## Focused CHECKLIST assessment

This table is an assessment of current contracts and wiring, not a second tasklist.
Markers were not changed, and prior test evidence was not relabelled as a fresh run.

| Existing task(s) | Current assessment |
| --- | --- |
| I.1; B.1-B.3; C.2; L.3-L.5 | Completed-module claims do not cover production composition: F1-F4 and F7 identify integration failures |
| B.6 | ✅ overstates crash/idempotency behavior; F5/F6 require targeted acceptance coverage |
| B.4/B.6 | Code format and entropy contract conflict, F10 |
| V.2 / MS.2 | Module implementation exists, but composed asset resolution fails, F3 |
| U.7 / U.8 | Completed components have route/lifecycle integration gaps; generator rejects discovered adapters |
| H.1 | Scaffold exists; identical shared UI source acceptance is not met by a token-only shell |
| V.1 / I.2 / I.3 | Already open; native packaging is not completion evidence, F8 |
| I.4 / R.7 | Already open; aggregate coverage and budget enforcement remain incomplete, F11 |
| U.9 | [X], with live semantic observation explicitly pending; no promotion justified here |
| W3-S2 / W3-Screens | Pending UI export/wiring; overlapping ownership needs contract reconciliation |
| OR.4 | Pending; exact implementation location and boundary are underspecified |
| W7-1 / W7-2 / W7-4 | Pending product/rubric/device evidence; no fresh release verdict issued |

The preamble's 52 ✅ / 2 [X] / 36 [ ] census is a dated declaration; grouped task
ranges and the later U.4-TW amendment make it unsuitable as a fresh mechanical
completion percentage.

## What supersedes the old report

- Both previously missing root TypeScript settings are present: the local-shell
  path and `allowImportingTsExtensions`. Current compiler success is unverified.
- I.1 now registers conversation; "zero registered routes" is obsolete. The issue
  is incomplete registration plus bypassed production services.
- Hosted source and thousands of tracked release paths now exist. Their presence
  is not shared-UI or runtime acceptance.
- Direct public HuggingFace downloads are an explicit architecture amendment.
  Third-party model URLs are not automatically an anti-fragility violation.
- The earlier 76-file dirty-state claim does not describe this review's initial
  worktree, which showed two untracked directories.

## Recommended next decision

Present the architecture/checklist corrections for operator signoff as previously
requested: prioritize F1-F5, assign integration ownership precisely, and reconcile
the marked-complete claims against the actual application path. Then execute only
approved task blocks, retaining per-[X] scoped commits and immediate publication
to available authorized destinations.

Forgejo unavailability affects primary Git/LFS publication and remote freshness;
it does not explain the source defects above. Preserve local commits, use the
existing GitHub code-only mirror where permitted, and record the Forgejo/LFS queue
explicitly. Do not describe a code-only mirror push as artifact replication.

This review itself changes only this report. Source fixes, specification amendments,
checklist marker changes, release builds and product signoff remain outside it.
