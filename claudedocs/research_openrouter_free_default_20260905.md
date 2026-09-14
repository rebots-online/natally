# Research: OpenRouter's free tier (`openrouter/free` + `:free` models) as a default model choice for natally

**Date:** 2026-09-05 · **Depth:** standard+ · **Mode:** research only (no implementation)
**Question:** What do Redditors and other online users say about OpenRouter's free option as a model choice — which model(s) are usually used, given natally's workload (system-prompted horoscope/tarot generation and companion-like chat, *not* coding)? Is it likely an apt default without having to specify a specific/expensive model?

---

## Executive summary

1. **`openrouter/free` is a real model ID** — a "Free Models Router" (released 2026-02-01) that randomly routes each request to *some* free-variant model on OpenRouter, filtering only for requested features (tools, structured outputs, image input). It is $0, 200K context — and per OpenRouter's own listing, "free to use during this testing period, and **prompts and completions are logged by the model creator for feedback and training**." (One third-party source shows a deprecation notice pointing at Horizon Beta; my direct fetch of the page showed it live with 25 routed models — see confidence notes.)
2. **The free tier's hard numbers make it structurally unsuitable as a shared production default:** 20 requests/minute, and **50 requests/day** across *all* free models per OpenRouter account — raised to 1,000/day only if the account has ever purchased ≥ $10 in credits. These are account-level, not per-user ("Making additional accounts or API keys will not affect your rate limits").
3. **Community consensus (r/openrouter, r/SillyTavernAI, r/Chub_AI, r/LocalLLaMA)** is consistent and blunt: free models are fine for *trying* models and light personal use, but are flaky in production — upstream rate-limit errors, models removed without notice, and quality variance from quantized free endpoints. The perennial free RP favorite (DeepSeek V3 0324) has already churned off the free list; the standard advice is "paid DeepSeek is so cheap it might as well be free."
4. **For natally specifically:** the free tier is a good fit for **dev/sandbox and the pre-checkout trial frame**, and viable as a default **only under a bring-your-own-key configuration** (where the 50/day limit is per end-user, which comfortably covers light personal horoscope + chat use). Under natally's likely shared-server-key configuration it is disqualified on arithmetic alone (50–1,000 requests/day for the *entire app*), and on privacy grounds regardless: free endpoints train on user prompts, which is a poor match for companion-chat intimacy + birth data in a monetized product. **Recommendation (for human decision):** default to a *specific, cheap paid* model (not `:free`, not `openrouter/free`); use `:free` variants for trial/dev only. Horoscope/tarot prose is a low-stakes workload — pennies per thousand readings on the cheap paid tier.

---

## 1. What "OpenRouter free" actually is

There is no single "free model." Two distinct things carry the name:

| Thing | What it is |
|---|---|
| `openrouter/free` ("Free Models Router") | A meta-model, released 2026-02-01: routes each request **at random** to a free-variant model available that day, filtered to models supporting whatever features the request needs (image input, tool calling, structured outputs). 200K context. $0. Listing states prompts/completions are logged by the model creator for training during the testing period. |
| `:free`-suffixed models | Individual models (e.g. `z-ai/glm-5.2:free`) offered at $0, typically in exchange for training/logging rights on prompts. Count as of Sep 2026: ~19–25, churning constantly. |

Related but different: `openrouter/horizon-beta` was a *stealth cloaked model* (Aug 2025, rumored OpenAI), free-but-logged, deprecated within days of launch. Several sources conflate it with the Free Models Router; they are separate things. `openrouter/auto` is a separate paid auto-router and does not route to free variants.

**Implication for natally:** `openrouter/free` is a *model lottery*. The model (and therefore voice, warmth, refusal behavior, formatting habits) changes request-to-request. For a horoscope reading that's tolerable; for a *companion persona* the user talks to across days, voice inconsistency is a product defect.

## 2. Free tier mechanics (from OpenRouter's official docs)

- **20 requests/minute** on free variants.
- **50 requests/day** across all free models if lifetime credit purchases < $10; **1,000 requests/day** once the account has purchased ≥ $10 credits (one-time unlock, not a subscription). The 50/day cap applies to **all free models combined**, not per model.
- Limits are **per account/key and global** — "Making additional accounts or API keys will not affect your rate limits, as we govern capacity globally."
- Upstream providers impose their *own* separate rate limits on free variants; 429s from upstream are the single most common complaint in community threads. A rate limit hit mid-stream arrives as an SSE error *after* a 200 response — relevant to client error handling.
- A negative balance 402s even free-model requests.
- **Privacy:** OpenRouter itself doesn't log prompts by default, but free variants generally require "providers that may train on inputs" to be enabled; turning off the training/logging toggles in Settings → Privacy makes most free models unavailable. Free models are free *because* creators log/train on them.

*(Note: one third-party source, CostGoat, states "200 req/day" — this contradicts OpenRouter's own docs of 50/1,000; the official numbers are authoritative.)*

## 3. The current free lineup (September 2026) and its churn

~19–25 models. The ones relevant to *non-coding, creative/persona* work:

| Model | Context | Community standing for chat/creative |
|---|---|---|
| `z-ai/glm-5.2:free` | 256K | The current headliner (~187B tokens used via OpenRouter collections). GLM line beloved for RP prose since 4.6 ("basically no censorship," natural dialogue); 5.1 praised as "insanely better than Opus 4.6" but with an "outrageous positive bias" (too agreeable); 5.2 debated as "smarter but a much worse writer" than 5.1, tuned toward agentic work. |
| `minimax/minimax-m3:free`, `minimax-m2.7:free` | 1M / 197K | Top free general-purpose alternates; strong multimodal. |
| `thinkingmachines/inkling:free` (+ `-small`) | 1M | Best free *reasoning* per rankings. |
| `nvidia/nemotron-3-*:free` (ultra-550b, super-120b, lightning, nano-omni) | 256K–1M | Present and large, but little RP-specific praise found. |
| `google/gemma-4-31b-it:free`, `gemma-4-26b-a4b-it:free` | 262K | Small-but-decent chat tier. |
| `cohere/north-mini-code:free`, `poolside/laguna-*:free` | 256K | Coding-oriented — irrelevant to natally. |

**Churn is the headline.** The historical free-community favorites are *gone from the list*: DeepSeek V3 0324 (the multi-year r/SillyTavernAI default answer), gpt-oss-120b, dolphin-mistral-24b. r/SillyTavernAI has a recurring thread ("Why does OpenRouter remove (free) models?"); a Sep 2026 article is titled "I stopped using free models on OpenRouter" over exactly this; CostGoat warns "Free models may be removed or have limits adjusted without notice" and recommends paid credits for production. Any pinned free default will eventually break silently.

## 4. What Redditors and other online users actually say

Synthesis across r/openrouter, r/SillyTavernAI, r/Chub_AI, r/LocalLLaMA, r/devops:

- **"Free = for testing, not for shipping."** The most consistent verdict. r/devops and the monetized-app crowd treat the free tier as an eval sandbox; r/openrouter regulars tell newcomers the move is buying the one-time $10 credits to unlock 1,000 free req/day.
- **Flakiness is the #1 complaint.** "Temporarily rate limited upstream" is the canonical failure (top comment in the best-free-models threads). Free variants sit on oversubscribed capacity; availability varies hour to hour.
- **For RP/companion/creative (our workload), the recurring named models were:** DeepSeek V3 0324 (until it churned off), Gemini free tier ("good for long detailed responses" but quality "fluctuates"), and the GLM line (4.6–4.7 era praise; 5.x contested). gpt-oss-120b gets coding praise, not prose praise.
- **Cheap-paid shaming is real:** when someone asks for free RP models, the common answer is that paid DeepSeek / Gemini Flash tiers cost so little that free isn't worth the pain. This matches natally's economics — see §5.
- **Provider quantization:** r/SillyTavernAI reports cheap/free GLM endpoints sometimes serve heavily-quantized weights, visibly hurting creative quality — i.e., even a "good" free model isn't reliably the model you've heard about.
- **Refusals/safety posture varies wildly on free endpoints** — a risk for a companion product that promises a consistent persona.

## 5. Fit analysis for natally (horoscope/tarot + companion chat)

Workload profile: short-to-medium creative prose, strong persona/system-prompt adherence, occasional structured output (tarot draws, reading frames), multi-turn warmth for companion chat, no coding, no long-context reasoning demands. Low per-request token volume; the binding constraints are **requests/day, consistency, and privacy** — not raw capability.

Three deployment configurations:

| Configuration | Verdict |
|---|---|
| **Shared server-side key, free models as default** | **Disqualified.** 50 (or 1,000) requests/day for the *entire user base*. One user's daily reading + chat session exhausts it. Also strains the spirit of OpenRouter's consumer-account limits, and routes paying users' companion conversations to training endpoints. |
| **Bring-your-own OpenRouter key, free as default** | **Viable and arguably apt.** 50/day is per-user, which covers a personal horoscope habit (daily reading + a few chat turns) with headroom; $10-credit users get 1,000/day. Graceful-degrade UX needed for 429s. Privacy tradeoff shifts to the user who chose it — disclose plainly. Churn still breaks pinned models, so route through `openrouter/free` or a config-level fallback list rather than one pinned `:free` ID. |
| **Shared key, specific cheap paid model as default** | **Recommended.** Horoscope/tarot prose is the cheapest possible LLM workload. A Gemini-Flash-class or DeepSeek-chat-class paid model runs a fraction of a cent per reading; even 10k readings/day is negligible against natally's paywall economics, and buys deterministic voice, no upstream-lottery 429s, and no-training data policies. Keep `:free`/`openrouter/free` for the pre-checkout trial frame, dev, and as a fallback rung. |

Cross-check against the community: this is exactly the shape of the advice free-tier veterans give — free for trial/eval, a specific cheap paid model for the product. The "without having to specify a specific model" wish is only safely served by `openrouter/free`'s lottery, and the lottery is precisely what a companion product shouldn't ship.

## 6. Recommendations (for human decision — no implementation performed)

1. **Do not make free the production default** under a shared key (arithmetic + privacy + churn).
2. **Adopt a two-tier ladder:** trial/dev/sandbox on `:free` (or `openrouter/free`); production default on one specific cheap paid model, with a second cheap paid model as fallback.
3. **If BYO-key is in scope,** free-as-default becomes a legitimate user choice; handle 429s as a first-class UX state ("daily free limit reached") and disclose training-on-prompts.
4. **Candidates to shortlist for the paid default** (per the same communities' non-coding verdicts): a Gemini Flash-class model and DeepSeek-chat-class model first; GLM paid tier as a creative-writing alternative — noting the 5.x-era complaints about prose regression and sycophancy, which matter for a *companion* persona. *(Selection and pricing verification are a follow-up decision.)*
5. Whatever is chosen, keep the model ID in configuration, not code — the free-list churn evidence says model IDs are perishable inventory.

## 7. Confidence levels

- **High:** rate-limit numbers and per-account semantics (OpenRouter docs, fetched directly); free-variant training/logging policy; the churn pattern; the shape of community sentiment (consistent across four subreddits and multiple 2026 articles).
- **Medium:** the exact current status of `openrouter/free` — my direct fetch showed it live with 25 routed models, but a search snippet quoting the page mentions a deprecation note pointing at Horizon Beta; the page may have changed recently or the note may refer to a different cloaked model. Verify on the live page before any implementation.
- **Medium:** RP-community model opinions are drawn from thread titles/quotes via search summaries (Reddit blocked direct fetching); directionally reliable, individual quotes not verified in full thread context.
- **Low/disregarded:** CostGoat's "200 req/day" figure (contradicts official docs).

## 8. Sources

**Official / docs**
- OpenRouter — API limits: https://openrouter.ai/docs/api-reference/limits
- OpenRouter — Free Models Router (`openrouter/free`): https://openrouter.ai/openrouter/free
- OpenRouter — Free models collection: https://openrouter.ai/collections/free-models
- OpenRouter — Roleplay collection: https://openrouter.ai/collections/roleplay
- OpenRouter — Provider logging & data retention: https://openrouter.ai/docs/guides/privacy/provider-logging
- OpenRouter — Data collection: https://openrouter.ai/docs/guides/privacy/data-collection
- OpenRouter — FAQ (50/day → 1,000/day wording): https://openrouter.ai/docs/faq
- OpenRouter — Horizon Beta (deprecated stealth model): https://openrouter.ai/openrouter/horizon-beta

**Community**
- r/SillyTavernAI — "What are the best free openrouter models" (upstream rate-limit complaints): https://www.reddit.com/r/SillyTavernAI/comments/1rgdd52/
- r/SillyTavernAI — "Open router best free models?" (DeepSeek 0324 era): https://www.reddit.com/r/SillyTavernAI/comments/1m13mj3/
- r/SillyTavernAI — "Why does OpenRouter remove (free) models?": https://www.reddit.com/r/SillyTavernAI/comments/1qo2cdk/
- r/openrouter — "Sigh…… what's the best free model right now for Role Play?": https://www.reddit.com/r/openrouter/comments/1r4gzq4/
- r/openrouter — "Which free model are you using?" ($10-credit tip): https://www.reddit.com/r/openrouter/comments/1toc1fw/
- r/openrouter — "Please give me your ranking for roleplaying models" (GLM 4.6–4.7 vs 5+): https://www.reddit.com/r/openrouter/comments/1tj9lt7/
- r/SillyTavernAI — "GLM 5.2 is smarter than 5.1, but a much worse writer": https://www.reddit.com/r/SillyTavernAI/comments/1uostwa/
- r/SillyTavernAI — "any good providers for glm 5.2?" (quantization complaints): https://www.reddit.com/r/SillyTavernAI/comments/1umutul/
- r/SillyTavernAI — "Glm 5.1 is really good… insanely better than opus 4.6" (positive-bias caveat): https://www.reddit.com/r/SillyTavernAI/comments/1t6d90z/
- r/Chub_AI — long-form RP model thread (Gemini free tier praise/fluctuation): https://www.reddit.com/r/Chub_AI/comments/1hiq4qf/
- r/LocalLLaMA — privacy implications of OpenRouter: https://www.reddit.com/r/LocalLLaMA/comments/1l98lly/
- r/devops — "Do you use OpenRouter? Pros and cons?": https://www.reddit.com/r/devops/comments/1rst4ob/

**Third-party writeups / trackers**
- CostGoat — "OpenRouter Free Models: All 19 Listed (Sep 2026)": https://costgoat.com/pricing/openrouter-free-models
- Teamday — "Best OpenRouter Free Models 2026": https://www.teamday.ai/blog/best-openai-models-openrouter-2026
- Klymentiev — "OpenRouter Free Tier 2026: Rate Limits, Models, BYOK": https://klymentiev.com/blog/openrouter-free-tier
- Plain English — "I stopped using free models on OpenRouter" (Sep 2026): https://ai.plainenglish.io/i-stopped-using-free-models-on-openrouter-b8e7a3c44d05

## 9. Operator decision addendum (2026-09-14)

**Directive (operator):** the webapp's default is **OpenRouter free** — the online nature of
a web app allows accessing free hosted models, subject to rate limits and **dynamic backing
off**; trial free access is to be limited anyway.

This refines §6 for the web edition(s): free-hosted-with-dynamic-backoff is the **default**
there, not merely the trial/dev rung. The §6 paid-default recommendation continues to govern
configurations where free-tier capacity or quality is insufficient. The operator's rationale
makes the trial frame the load-bearing control: since free access is trial-limited
regardless (D11 gate), the free tier's 50 req/day account cap and the product's own usage
cap align rather than conflict.

Unresolved at this recording (for the architect pass; likely a D-entry alongside the parked
system-module seam decision):

1. **Which webapp(s):** the local app's web PWA leg (currently specified local-inference —
   D10 "all four legs run local inference", C.1 web lane = wllama, §11 egress = mirror +
   license only), the future hosted SaaS (whose inference egress §8.1 already contemplates),
   or both.
2. **Key topology:** shared server key vs per-user BYO-key decides whether 50/day is the
   app's whole budget or each user's; the limit is account-level either way (§2).
3. **Privacy posture:** free variants train on prompts (§2); Tier-1 chart facts + lore
   fragments would flow to a training-enabled endpoint — §11/§8.1 wording must be amended if
   the PWA leg is in scope, and disclosed plainly to users either way.
4. **Voice consistency:** `openrouter/free` routes per-request at random (§1); for the
   companion persona, pin a config-level fallback list rather than the bare router, per
   §6 item 5 (model IDs are perishable inventory).
