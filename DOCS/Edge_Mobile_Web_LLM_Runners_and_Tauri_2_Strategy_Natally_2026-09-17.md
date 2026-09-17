# Edge Mobile and Web LLM Runners with Tauri 2

Technical landscape, breakthrough assessment, and architecture direction for the shared Chatbot Module and the EnZIME, Natally, SanctissiMissa, Kintsugi, HKG, Atomic Chat, and Recruiser product lines

Research cutoff: 13 September 2026

Natally continuation added 17 September 2026. GLM-5.3 should begin with sections 12–18 for the current reconciliation, shared-storage design and implementation handoff. Sections 1–11 retain the dated research and do not replace Natally’s current product contracts.

## Executive conclusion

The approximately 3.9 GB 1-bit Bonsai 27B remains the most striking intelligence-per-download result found, but it is not yet a clean multi-platform replacement for conventional 3B–9B local models. Its achievement is principally a co-designed low-bit model and specialized-kernel achievement. Shipping the file everywhere is easier than executing it well everywhere: native desktop, Android, iOS, and browsers expose different memory ceilings, accelerator APIs, kernel languages, and background-execution rules.

The best architecture for the active projects is therefore a stable, model-neutral Chatbot Module with a capability-negotiated runner layer. Use llama.cpp or the existing atomic-llama-cpp-turboquant line as the compatibility anchor for desktop and Android; evaluate Google LiteRT-LM as the strategic cross-platform accelerator path; use WebLLM/MLC or llama.cpp WebGPU for browsers; and keep a CPU/WASM fallback for low-end or unsupported devices. Bonsai should be an optional high-density tier until its binary and ternary kernels, licensing, memory behavior, and browser path pass a reproducible device matrix.
| Question | Finding | Decision |
| --- | --- | --- |
| Is anything clearly better than 4 GB Bonsai 27B? | No universal drop-in. Some alternatives improve speed, energy, multimodality, or portability, but none verified here dominates Bonsai simultaneously on size, quality, and all target platforms. | Treat Bonsai as a benchmark and optional engine, not the application ABI. |
| Most important new runtime development | LiteRT-LM now claims Android, iOS, web, desktop, and IoT with CPU/GPU/NPU, multimodality, and tool use. | Prototype it behind the same runner interface; do not replace the proven path yet. |
| Best near-term Tauri 2 design | Web UI and shared TypeScript orchestration; Rust command/event bridge; platform-specific native engines; browser worker engine. | One product surface, multiple execution providers. |
| Does TurboQuant solve the 4 GB model problem? | No. TurboQuant compresses the growing KV cache, not the model weights. It is highly complementary for long context. | Keep it as an independent capability negotiated per runner. |

## 1 Scope and evaluation method

The comparison asks whether an app can deliver useful local generation across Windows, Linux, Android, iOS, and ordinary browsers, with Tauri 2 as the installed-app shell. “Multi-platform” is scored at the engine level, not merely at the user-interface level. A model is considered deployable only if its weights fit alongside runtime overhead and KV cache, it can be packaged and loaded under platform rules, and prompt processing and generation remain usable.

| Dimension | What counts |
| --- | --- |
| Model density | Download size and resident weight memory, including scales and metadata. |
| Working memory | Weights plus graph/runtime allocations, scratch buffers, tokenizer, retrieval state, and KV cache. |
| Execution reach | Windows, Linux, macOS, Android, iOS, and browser support actually documented or demonstrated. |
| Acceleration | CPU SIMD, CUDA, Metal, Vulkan, WebGPU, Core ML/ANE, NNAPI/QNN, or other NPU routes. |
| Model reach | Ease of accepting new architectures and quantizations without a bespoke conversion fork. |
| Product fit | Streaming, cancellation, structured output, tools, embeddings, multimodality, licensing, updates, and offline behavior. |

## 2 What the Bonsai result actually changes

PrismML describes Bonsai 27B as a phone-capable family with a 3.9 GB 1-bit build and a 5.9 GB ternary build. It attributes multi-step reasoning, tool use, agentic workflows, and multimodal understanding to the family. These are vendor claims and should be validated task-by-task; nevertheless, the storage result is real enough to alter product planning because it puts a nominal 27B-class checkpoint inside a download envelope previously associated with 7B–9B models.¹

The central caveat is that parameter count is not a quality measure and post-training extreme quantization is not automatically equivalent to native low-bit training. The public artifacts also show more than one operating point and runtime path. Independent community testing found a 7.17 GB ternary GGUF requiring a PrismML llama.cpp fork for its custom Q2_0_g128 CUDA path, with useful but workload-dependent results. That is evidence of practical execution, but also evidence that mainline runtime portability cannot be assumed.²

- The 3.9 GB figure describes the weight artifact, not peak process memory.

- A 27B transformer still performs roughly 27B-parameter-scale memory traffic unless kernels exploit the binary representation directly; dequantizing into wider intermediates can erase much of the promised speed or memory advantage.

- Long contexts can exceed weight memory through KV growth. Grouped-query attention, sliding windows, cache quantization, and retrieval discipline matter as much as the weight file.

- Browser delivery adds cache quotas, range-download behavior, WebGPU buffer limits, shader compilation, and tab-lifecycle constraints.

- “Runs on a phone” is not equivalent to “fits every supported phone with a responsive product UI.” Device qualification remains essential.

## 3 Breakthroughs and near-breakthroughs

### 3.1 Native low-bit models and kernels

BitNet b1.58 and bitnet.cpp remain the foundational open route for models trained around ternary weights rather than merely crushed after training. Microsoft’s reference runtime documents optimized CPU kernels across x86 and ARM and positions GPU and NPU support as an expanding direction. This is a stronger long-term foundation than assuming arbitrary FP16 models can always survive 1-bit post-training conversion, but model availability and production integrations remain narrower than GGUF/llama.cpp.³

Bonsai is the most relevant 2026 commercialization of this direction for the requested size envelope. The breakthrough is not simply “a better quantizer”; it is an intelligence-density product built around low-bit inference. The prudent comparison target is therefore quality per byte and quality per joule on the exact application tasks—not parameter count or a single general benchmark.

### 3.2 KV cache compression

TurboQuant is complementary rather than competitive with Bonsai. Google’s method applies randomized rotations and near-optimal scalar quantizers, with a one-bit residual correction for unbiased inner products. The paper reports quality-neutral KV compression at about 3.5 bits per channel and marginal degradation at 2.5 bits per channel; Google reports strong long-context results without calibration or fine-tuning.⁴ ⁵

This matters directly to EnZIME and the shared chatbot because retrieved passages, citations, conversation state, and tool traces create long contexts. A four-gigabyte model can still become unusable if an uncompressed cache is allowed to grow. TurboQuant should stay a separately advertised runner capability, with fallback to conventional Q8/Q4 KV where fused kernels are unavailable. Newer work such as HyperQuant reports improvements below two bits per scalar, but it is research-stage and currently emphasizes H100 tensor-core paths rather than phone/browser deployment.⁶

### 3.3 WebGPU becomes a real llama.cpp target

The 2026 LlamaWeb work adds a WebGPU backend for llama.cpp and reports browser-focused memory and performance engineering. This potentially reduces the historical split between GGUF-native apps and browsers, where MLC/WebLLM previously required its own compiled artifacts. It is strategically important, but a new backend should be treated as an incubating provider until browser compatibility, shader compilation, memory limits, and the required quantization types are verified.⁷

### 3.4 Unified accelerator orchestration

LiteRT-LM is the strongest new multi-platform development. Google describes it as a production-ready orchestration layer over LiteRT for Android, iOS, web, desktop, and IoT, with CPU, GPU, and NPU acceleration, multimodality, constrained function calling, and support for model families including Gemma, Llama, Phi, and Qwen.⁸ This breadth aligns almost exactly with the desired Chatbot Module, but its supported converted artifacts and low-bit operators must be tested against Bonsai rather than inferred from the family names.

## 4 Runner landscape

| Runner | Platforms and strengths | Limits for this program | Recommended role |
| --- | --- | --- | --- |
| llama.cpp / GGML | Windows, Linux, macOS, Android/iOS integrations; CPU, CUDA, Metal, Vulkan and broad GGUF model reach. Very active upstream. | Browser WebGPU is newer; mobile packaging is integrator-owned; exotic 1-bit formats may require forks. | Primary compatibility engine; desktop and Android baseline. |
| atomic llama cpp TurboQuant | Existing architectural direction with native C++ and compressed KV cache. Minimal disruption to current Tauri bridge. | Fork maintenance and parity burden; each upstream architecture or backend change must be reconciled. | Current long-context native engine, kept behind stable ABI. |
| LiteRT-LM | Officially described cross-platform CPU/GPU/NPU stack; multimodal and constrained tool use. | Newer ecosystem; conversion, model coverage, binary size, licensing and device-specific delegates need qualification. | Strategic second engine and possible future default on supported hardware. |
| MLC LLM / WebLLM | Shared compiler/runtime family across JS, iOS, Android and native; mature WebGPU story; workers, streaming, caching and OpenAI-like JS API. | Models generally need MLC compilation; less frictionless than downloading arbitrary GGUF; custom low-bit kernels need compiler work. | Browser/PWA default today; optional native accelerator path. |
| llama.cpp WebGPU / LlamaWeb | Promise of one GGUF ecosystem reaching browsers; memory-efficient browser focus. | Young backend and browser variability; confirm quant types and production stability. | Experimental browser provider with high consolidation value. |
| ExecuTorch | PyTorch on-device stack for mobile/embedded; delegates to platform accelerators; active LLM examples and vendor backends. | Not a browser runtime; export/operator constraints; larger integration surface for a web-first Tauri application. | Specialized mobile/NPU provider when benchmarks justify it. |
| ONNX Runtime GenAI | Broad OS/language reach and CPU/GPU/NPU execution providers; web and mobile variants. | Generative-AI API/model-builder maturity and low-bit LLM coverage vary by provider; uncommon quant formats need operators. | Enterprise portability option, especially Qualcomm/Windows paths. |
| MediaPipe LLM Inference | Straightforward Android/iOS integration and Google-supported samples. | Google now directs attention toward LiteRT-LM; narrower desktop/web unification. | Legacy/mobile fallback, not the new center. |
| Transformers.js | Excellent JS ergonomics and ONNX Runtime Web foundation; broad non-LLM multimodal tasks. | Large autoregressive LLM performance and memory usually trail specialized WebLLM/llama.cpp paths. | Embeddings, classifiers, speech and smaller browser models. |
| MNN / mobile-native engines | Strong Android/iOS efficiency; research reports meaningful energy savings and speedups. | No natural browser/Tauri-wide unification; additional conversion and bindings. | Benchmark challenger for battery-sensitive Android/iOS. |
| BitNet.cpp | Purpose-built x86/ARM CPU kernels for native 1.58-bit models. | Narrower model ecosystem and incomplete universal accelerator/browser story. | Research provider and possible Bonsai-adjacent CPU route. |

## 5 The multi-platform architecture that follows

Tauri 2 should own installed-app lifecycle, security capabilities, filesystem access, updates, billing hooks, and the Rust-to-native boundary. It should not define the inference implementation. The browser build should consume the same TypeScript interfaces but instantiate a worker-hosted WebGPU/WASM runner instead of invoking Rust commands.

| Layer | Shared contract | Platform realization |
| --- | --- | --- |
| Experience | Docking, resize, theming, transcripts, citations, visible thought/status policy, accessibility. | Same web frontend inside Tauri WebView and PWA. |
| Orchestration | Messages, retrieval, tools, prompt policy, structured output, cancellation, telemetry consent. | TypeScript package with no runner-specific imports. |
| Capability broker | Probe memory, acceleration, context ceiling, model formats, multimodal and tool constraints. | Rust/native probe in Tauri; JS/WebGPU probe in browser. |
| Runner ABI | load, warmup, generate stream, embed, tokenize, cancel, unload, health, estimate memory. | Rust plugin providers or browser Worker providers. |
| Model manager | Signed manifest, resumable chunks, hashes, variants, storage policy, license acceptance. | Filesystem on native; Cache Storage/OPFS on web. |
| Knowledge services | ZIM/PDF parsing, embeddings, graph memory, citations, context packing. | Shared schemas; platform-specific storage/index adapters. |
| Control plane | Entitlements, model catalog, optional cloud fallback, privacy-preserving diagnostics. | BIDLR-compatible service boundary; offline grants cached locally. |

## 6 Tauri 2 developments and implications

Tauri 2 reached stable mobile support in 2024 and by the 2.11 line had continued hardening mobile APIs, permissions, runtime behavior, and plugins. The 2.11.1 release, for example, exposed monitor APIs on mobile and fixed an Android permission crash. The current stable line found in the official release pages is 2.11.5, dated 1 July 2026.⁹ ¹⁰

More consequentially, Tauri 3.0.0 alpha appeared on 13 September 2026. Its first alpha separates webview runtime selection more explicitly, exposes Android binding mechanisms for alternative runtimes, reduces resolved ACL size, permits Wry or CEF runtime selection, and changes resource behavior during development.¹¹ This is architecturally interesting for native AI plugins, but not a reason to move shipping applications off Tauri 2 yet.

- Remain on a pinned Tauri 2.11.x production line for current releases; consume security and packaging fixes deliberately.

- Design the inference plugin boundary so Tauri 3 runtime separation is an easy future migration, but do not compile product logic against alpha-only APIs.

- Treat Android and iOS as genuine native targets with Kotlin/Swift glue where needed. A shared Rust core does not eliminate mobile lifecycle, permission, thermal, or store-policy work.

- Keep the web application independently runnable. Tauri’s system WebView produces smaller packages, but WebView feature versions differ by OS; native inference avoids making WebGPU availability a requirement for installed builds.

- Continue generating Windows EXE and NSIS from cross-platform CI where supported, but preserve MSI/MSIX as Windows-native signing/package stages, matching the established build policy.

## 7 Project trajectory assessment

| Project | Trajectory fit | Immediate implication |
| --- | --- | --- |
| Chatbot Module | Excellent. The configurable docked/intercom UI and shared orchestration are exactly the correct abstraction boundary. | Finalize runner ABI and capability broker before adding more engines. |
| EnZIME | Highest-value beneficiary: offline-first, ZIM/PDF retrieval, citations, preparedness use, and mandatory local AI make model and KV efficiency product-defining. | Ship a dependable smaller baseline plus qualified high-density Bonsai tier; make storage-aware DynDon coordinate model and knowledge downloads. |
| Natally | Good fit where private journaling, personal context, or local assistant features matter; mobile lifecycle is more important than maximum parameter count. | Prioritize fast warm start, battery/thermal budgets, and a compact default model. |
| SanctissiMissa / StAndroidsMissal | Excellent for offline liturgical corpus, public-domain Catholic works, cited answers, homily and journaling. | Use retrieval quality and citation fidelity as acceptance tests; a specialized 4B–9B may beat a generic 27B for UX. |
| Kintsugi Oracle | Good modular fit, with a distinct persona and visual experience over the common runner. | Separate spiritual/creative interpretation policy from engine choice; retain optional premium cloud tier. |
| HKG / knowledge graph apps | Strong fit: runner-neutral streaming and embeddings can drive the 6-DoF knowledge surface. | Do graph and retrieval work outside the LLM runner; expose structured citation/node events. |
| Atomic Chat | Direct fit; it is already closest to the native llama.cpp/TurboQuant execution concept. | Use it as the runner proving ground, then consume the module rather than maintaining a separate engine architecture. |
| Recruiser / 3D capture | Partial fit. Local multimodal guidance can be valuable, but camera/splat reconstruction and spatial audio need dedicated perception pipelines. | Use the Chatbot Module as coordinator and explanation surface, not as the reconstruction engine. |
| BIDLR | Orthogonal but necessary for commercial distribution. | Entitle model tiers and cloud fallback without coupling billing code to inference providers. |

## 8 Recommended model and runner tiers

| Tier | Typical target | Model strategy | Runner order |
| --- | --- | --- | --- |
| Universal baseline | 8 GB RAM desktop; modern 6–8 GB Android; broad browsers | A strong 3B–4B instruct/abliterated role-tuned model, conservative context, retrieval-first. | Native llama.cpp; web WebLLM; CPU/WASM fallback. |
| Quality mobile | 12–16 GB unified/RAM devices | 7B–9B Q4 or native low-bit model; device-specific context budget. | LiteRT-LM or llama.cpp, selected by qualification. |
| High-density experimental | Flagship phones and ordinary laptops | Bonsai 27B 1-bit at about 3.9 GB, contingent on kernel and quality validation. | PrismML-supported native path; never silently fall back to dequantizing implementation. |
| Laptop quality | 16 GB+ laptops / 24 GB GPU workstation | Ternary Bonsai 27B or conventional larger Q4/MoE chosen by task benchmark. | llama.cpp/CUDA/Metal; LiteRT-LM challenger. |
| Long context | Any tier with sustained document work | TurboQuant 3.5-bit-class KV where fused and validated; otherwise Q4/Q8 KV plus retrieval/context compaction. | Capability flag, not a separate UX mode. |
| Premium connected | Devices failing local quality/latency threshold | User-selected cloud model with local retrieval redaction and explicit egress. | Provider adapter controlled by entitlement and privacy policy. |

## 9 Acceptance matrix for a genuine Bonsai improvement

A candidate only improves on the Bonsai baseline if it wins the application-level test, not merely model size. The same harness should run representative tasks from every product and record cold load, peak memory, prefill, decode, energy/thermal behavior, first-token latency, citation correctness, tool-schema validity, and crash recovery.

| Gate | Pass condition |
| --- | --- |
| Artifact | Signed, resumably downloadable, license-compatible artifact with reproducible conversion and pinned upstream mirror. |
| Memory | Peak memory fits the advertised device tier with the UI, index, and target context active; at least 20% safety headroom. |
| Latency | Interactive time to first token and sustained decode on each reference device; no hidden server dependency. |
| Quality | Beats the smaller baseline on EnZIME synthesis, SanctissiMissa citation fidelity, Natally tone/structure, and coding/tool tests. |
| Context | Measured cache growth and retrieval behavior at 8K, 32K, and longer supported windows; no claim based only on declared model context. |
| Thermals | Ten-minute and thirty-minute runs without unacceptable throttling, OS termination, or battery draw. |
| Portability | Windows 11, Ubuntu, target Android devices, and two browser GPU families pass; iOS is separately qualified if in launch scope. |
| Operations | Cancellation, suspend/resume, model eviction, update rollback, corrupted-download recovery, and diagnostics all work. |

## 10 Implementation roadmap

| Phase | Deliverable | Exit criterion |
| --- | --- | --- |
| 0 Contract freeze | Runner ABI, capability schema, model manifest, event protocol, privacy/entitlement hooks. | Mock runner passes identical frontend and orchestration tests on web and Tauri. |
| 1 Dependable baseline | llama.cpp native provider and WebLLM browser provider; compact default models. | Windows, Linux, Android and browser release matrix passes. |
| 2 Context advantage | TurboQuant provider path, cache telemetry, retrieval-aware context budgets. | Long-document tests show memory advantage without citation/quality regression. |
| 3 Bonsai qualification | Binary and ternary artifacts, supported kernels, device benchmark harness, abliterated/role-tuned comparison where licensing permits. | Promotion only on device classes where it beats baseline end-to-end. |
| 4 Accelerator challenger | LiteRT-LM provider with GPU/NPU delegates and multimodal/tool tests. | Wins latency/energy or reach on a material target segment. |
| 5 Consolidation | Evaluate llama.cpp WebGPU as GGUF browser provider; reduce duplicate formats only if reliable. | Browser compatibility and model-cache migration are production-safe. |
| 6 Product rollout | Adopt module in Atomic Chat first, then EnZIME and SanctissiMissa, followed by Natally/Kintsugi/HKG. | No project imports an engine directly; all use the common contract. |

## 11 Strategic judgment

The projects are on the right trajectory insofar as they already favor Tauri 2, local execution, shared orchestration, and TurboQuant. The correction is to stop treating a particular llama.cpp fork, model family, or browser package as the module. The module is the stable contract and product experience; engines are replaceable providers selected from observed capabilities.

Bonsai changes the aspirational ceiling: a local 27B-class tier is now plausible in a four-to-six-gigabyte download. LiteRT-LM changes the integration horizon: a serious cross-platform CPU/GPU/NPU stack now targets essentially the whole device set. Tauri 3 alpha changes the future shell architecture, but Tauri 2 remains the correct production baseline. Together these developments validate the modular strategy rather than collapsing it into one runtime.

For commercial launch, the winning message is not “27 billion parameters on every phone.” It is “fast, private, cited local intelligence that automatically uses the best engine your device can genuinely sustain.” Bonsai can make that promise more impressive on qualified devices; retrieval, device-aware selection, and graceful degradation make it true everywhere else.

## Sources

1. PrismML, “Bonsai 27B,” July 2026. https://prismml.com/

2. Japanese LLM Benchmark, community Bonsai 27B GGUF tests, 2026. https://github.com/shi3z/japanese-llm-benchmark

3. Microsoft, “BitNet: Official inference framework for 1-bit LLMs.” https://github.com/microsoft/BitNet

4. Zandieh et al., “TurboQuant: Online Vector Quantization with Near-optimal Distortion Rate,” 2025. https://arxiv.org/abs/2504.19874

5. Google Research, “TurboQuant: Redefining AI efficiency with extreme compression,” 2026. https://research.google/blog/turboquant-redefining-ai-efficiency-with-extreme-compression/

6. Domb et al., “HyperQuant,” June 2026. https://arxiv.org/abs/2606.23406

7. Levine et al., “Llamas on the Web,” May 2026. https://arxiv.org/abs/2605.16556

8. Google AI Edge, “LiteRT-LM Overview,” September 2026. https://developers.google.com/edge/litert-lm/overview

9. Tauri, “tauri 2.11.1,” May 2026. https://v2.tauri.app/release/tauri/v2.11.1/

10. Tauri, “tauri 2.11.5,” July 2026. https://v2.tauri.app/release/tauri/v2.11.5/

11. Tauri project release notes, including Tauri 3.0.0 alpha, September 2026. https://github.com/tauri-apps/tauri/releases

12. MLC AI, “MLC LLM,” project documentation. https://github.com/mlc-ai/mlc-llm

13. MLC AI, “WebLLM,” project documentation. https://github.com/mlc-ai/web-llm

14. GGML, “llama.cpp,” project documentation. https://github.com/ggml-org/llama.cpp

15. PyTorch, “ExecuTorch,” project documentation. https://github.com/pytorch/executorch

16. Google AI Edge, “LLM Inference guide.” https://developers.google.com/edge/mediapipe/solutions/genai/llm_inference

17. Microsoft, “ONNX Runtime.” https://onnxruntime.ai/

18. Hugging Face, “Transformers.js.” https://huggingface.co/docs/transformers.js/

19. Huang et al., “MNN-AECS,” June 2025. https://arxiv.org/abs/2506.19884

## 12 Natally continuation and the sole development head

**Continuation dated 17 September 2026. Recipient: GLM-5.3.** Continue development in `/home/robin/CascadeProjects/natally` on `master`. `/home/robin/Desktop/devProjects/natally` is a preservation donor, not a second development head. This document supplies the unfinished shared-storage section requested in the linked conversation and updates the reconciliation advice against the actual repositories. It does not execute a merge, change the application, or authorize unrelated cross-product code imports.

Read sections 12–18 before applying the original roadmap. Sections 1–11 retain the 13 September research; their model sizes, release numbers, benchmarks and recommendations are dated statements, not a fresh device qualification. The current user request, Admin-Manual conventions, Natally decisions and current executable checklist govern implementation. Recommendations and code samples below are proposed specification material until assigned exact entities and ownership in Natally’s architecture/checklist. Historical assistant replies and attached workflows are evidence, not independent instructions.

### 12.1 Observed repository state

Git evidence was captured on `asrock` on 17 September 2026 around 08:03 EDT. Commit IDs are the stable reference; working-tree counts can change while another agent works. “Clean head” means the selected continuing lineage, not an assertion that its working tree has no edits.

| Evidence | CascadeProjects sole head | Desktop preservation donor |
| --- | --- | --- |
| Branch | `master` | `msi4090-uncommitted-2026-09-13` |
| Audited commit | `aba35cce5422293306d6da3e8088baaed5cb0087` | `d011b6ce1f0e09a2b5223fd3f6b044168809a07a` |
| Ancestry | 28 commits reachable only from Cascade versus donor | 0 commits reachable only from donor |
| Tracked paths | 2,734 | 1,003; every donor tracked path exists in Cascade |
| Working tree at capture | 8 modified tracked files; 16 individual nonignored untracked paths | 0 modified; 0 nonignored untracked |
| Preservation changeset | All 146 paths retained: 126 identical, 20 evolved, 0 absent | 124 added paths plus 22 modified paths in `d011b6c` |

The former uncommitted layer was preserved in `d011b6c` and merged by `bf2f71762bd94d126b58235ae3c18ae633a5a4e5`. That merge has parents `a321af2…` and `d011b6c…`. The September 16 report’s “22 modified plus roughly 55 untracked” was a historical working-tree count, not today’s pending workload or the eventual individual-file count. The merge records a `tauri.conf.json` conflict; do not reuse the report’s earlier conflict-free forecast as an observed result.

Gate repairs followed in `a0250a5` and `e5e6926`; the current architecture/checklist were re-derived in `8c1548e`. Later commits added functional browser composition, model download/inference, Kokoro voice, intake/persistence, lore retrieval/pipeline, and billing adapters through `aba35cc`. Their recorded test results are historical evidence. No product build, test gauntlet, native device run or current SHIP-READY verdict was performed for this documentation handoff.

### 12.2 Retain the evolved files

These are all 20 preservation paths whose committed content changed between donor `d011b6c` and audited Cascade `aba35cc`. Retain the Cascade versions; use the donor diff only to investigate a concrete omission. The other 126 preservation paths are byte-and-mode identical at those commits.

| Area | Evolved paths relative to the repository root |
| --- | --- |
| Contracts | `CHECKLIST.md`; `DOCS/ARCHITECTURE.md` |
| Package and native configuration | `apps/local/package.json`; `apps/local/src-tauri/Cargo.lock`; `apps/local/src-tauri/Cargo.toml`; `apps/local/src-tauri/tauri.conf.json` |
| App and data | `apps/local/src/app.tsx`; `apps/local/src/data/db.ts`; `apps/local/src/data/data.test.ts` |
| Conversation | `apps/local/src/screens/conversation/ConversationScreen.tsx`; `conversation.css`; `conversation.test.tsx`; `index.ts`; `types.ts`; `use-conversation.ts` in that same directory |
| Shell | `apps/local/src/ui/shell.tsx` |
| Voice | `apps/local/src/voice/ban-guard.test.ts`; `envelope.test.ts`; `web.test.ts`; `web.ts` in that same directory |

In particular, do not restore the donor’s broken database-worker URL or old conversation-ledger test. Do not replace current `CHECKLIST.md` with the older markers. The imported audit remains useful for finding history, while each current behavior requires its own evidence.

Concurrent Cascade work includes version/package/Cargo/Tauri surfaces, untracked billing `registry.ts` and `registry.test.ts`, vendor ephemeris assets, and local tooling/configuration. Leave these with their current owner. Never sweep them into a documentation commit. At capture, committed `version.txt` was `1.14.26755`, working `version.txt` was `1.27.27365`, and the latest commit subject used `v1.30.27390`; this is a version-provenance discrepancy to reconcile in R.5/R.6, not permission to stamp or revert another agent’s files.

The expected outbox snapshot directory exists, but its completeness was not validated here. Desktop has no `RELOCATED.md` marker. Clean Git status excludes ignored `.env`, caches and build directories; it does not justify deleting the donor. The requested sole-head policy can be followed immediately while snapshot verification, the relocation marker and registry disposition are completed in the existing close-out task.

## 13 Shared storage identity and the reusable asset contract

The intended benefit is **one download of an identical multi-GB asset, reused by every authorized ecosystem app on that device**. Share by content identity, not product name, developer account, model display name or download URL. A different quantization, tokenizer revision, compiled runner format or ZIM release is a different artifact even if its marketing name matches. Sharing a logical model cannot make GGUF, MLC and LiteRT binaries interchangeable.

Use a public `.env` value selected at build time, illustrated as `VITE_STORAGE_SCOPE=shared-content-v1`. This value is independent of `mba.robin`, package IDs, storefront identity and branding. Keep platform authorization identifiers separate: Android provider authority and allowed package/certificate pairs, Apple App Group entitlement, and an optional desktop root policy. A common scope never grants OS permissions. A scope change is a storage migration, not a branding edit; retain old discovery aliases until assets have been accounted for.

| Record | Proposed contents and purpose |
| --- | --- |
| Build identity | Storage scope; schema version; platform adapter policy. Public constants, frozen into both frontend and native artifact. |
| Content identity | SHA-256 of exact bytes plus expected byte count. An immutable object path such as `objects/sha256/ab/<full-digest>`; scope selects the library, not the hash. |
| Logical catalogue alias | Asset ID and immutable revision mapped to digest, format, model architecture, quantization, license, minimum runtime and dependency bundle. Multiple aliases may resolve to the same bytes. |
| Runtime qualification | Backend/version, context limit, tokenizer/chat template, hardware capability and successful compatibility evidence. Separate from file presence. |
| Access locator | Authorized native path, file descriptor plus offset/length, document URI, security-scoped bookmark, or browser handle/stream. Never force every platform into a path string. |
| Usage claim | Consumer identity, active read lease/pin, lifetime and recovery rules. Needed before any shared eviction or uninstall cleanup. |

Recommended layout: one immutable object store, a small transactional catalogue/alias index, resumable partial objects, per-content writer locks and reader leases. Private app data remains in each application’s own data directory/database. A library’s scope is discoverable public configuration; it is not a secret, an entitlement or an authorization token. Authenticate catalogue provenance separately from checking content hashes; a hash supplied by an untrusted catalogue proves no publisher identity.

**Shared candidates:** public LLM weights, tokenizers, runtime-compatible compiled variants, Kokoro and embedding weights, licensed public ZIM files, and immutable authored public lore packs. **Private by default:** birth details, people, charts, conversations, generated companion text, personal GraphRAG nodes/edges/embeddings, licenses, keys and usage ledgers. Public and personal lore must retain separate provenance and deletion behavior. Sharing an embedding model does not make personal embeddings public. A public precomputed embedding index additionally pins corpus digest, chunking recipe, model revision, dimension and normalization.

## 14 Platform storage architectures

### 14.1 Desktop platforms

| Platform and distribution | Recommended access strategy | Boundary and fallback |
| --- | --- | --- |
| Windows EXE or NSIS | Same-user library under the OS LocalAppData known folder plus the build scope, independent of app bundle ID. Native broker returns read-only handles/paths. | Resolve the known folder through the OS; do not hardcode `C:\\Users`. Cross-user sharing needs an explicitly provisioned ProgramData location with deliberate ACLs. |
| Windows packaged or sandboxed | Qualify package virtualization and capabilities; use an authorized selected folder or a supported app-group/shared broker arrangement. | A Win32 path recipe does not automatically apply to every MSIX/AppContainer identity. Package and grant behavior must be tested. |
| Linux AppImage or deb | Same-user `$XDG_DATA_HOME/<scope>` or `$HOME/.local/share/<scope>`; OS file locks, read-only consumer handles and transactional publication. | Flatpak/Snap confinement may require document-portal grants or an explicitly permitted broker. Different users are a separate administration policy. |
| macOS unsandboxed | Same-user Application Support directory plus scope; selected external libraries use durable bookmarks where appropriate. | Sandboxed builds need approved access, typically a same-team App Group or user-selected security-scoped resource. Branding does not remove sandbox checks. |

Keep downloaded models in durable data storage when the product promises retention; OS cache directories may be reclaimed. Installers must not recursively remove a shared library during app uninstall. Prefer a per-user broker or a portable local catalogue with cross-process locks; no always-online service is required. Map a verified read-only file in the native engine where supported. Keep Windows handles and mappings alive until inference ends; active leases prevent replacement/deletion during a read. Updates publish a new digest alongside the old, then atomically switch catalogue aliases. Resolve Windows known folders and reject relative XDG values. Tauri app-data helpers include app identity, so use them for private state rather than assuming they identify the shared root. [Windows known folders](https://learn.microsoft.com/en-us/windows/win32/shell/knownfolderid), [XDG paths](https://specifications.freedesktop.org/basedir/0.8/), [Tauri path API](https://v2.tauri.app/reference/javascript/api/namespacepath/)

### 14.2 Android

Android app-specific internal and external directories are not an ecosystem-wide shared filesystem. Matching `mba.robin` prefixes or storage scopes do not let one app read another app’s sandbox. Do not base this feature on `sharedUserId`, unrestricted storage permissions, raw `/sdcard` paths or assumed access to another app’s `Android/data` directory. [Android storage](https://developer.android.com/training/data-storage)

Use two complementary access paths. A user-selected Storage Access Framework library works across brands and signing identities: each consumer obtains and persists its own grant to the same library. An optional installed library-provider app can own the catalogue/download transactions and offer narrow read URIs/file descriptors to authorized clients. Separate provider installation/discovery from the asset’s identity, and record what happens if the provider is removed. SAF itself does not grant one app the permissions previously given to another. Android 11 restricts which directory roots the picker can grant. [SAF guidance](https://developer.android.com/training/data-storage/shared/documents-files)

On Android 11/API 30 and later, `BlobStoreManager` is another candidate for immutable blobs. Use an exact shared `BlobHandle` identity: digest, label, expiry timestamp and tag must all agree between apps. Keep these fields in canonical metadata; do not generate a different expiry in every consumer. Access may be same-signature, explicit package plus signing certificate, or public; cross-brand is therefore possible, but not implied. BlobStore quotas, expiry and lease management mean it is not a guaranteed permanent multi-GB repository. Probe allocation/commit failures and retain SAF/provider alternatives. `openBlob` can report absent and inaccessible through the same security exception, so that alone cannot justify automatic redownload. [BlobStoreManager](https://developer.android.com/reference/android/app/blob/BlobStoreManager) and [BlobHandle](https://developer.android.com/reference/android/app/blob/BlobHandle)

A content URI is not a filesystem pathname. Open it through `ContentResolver`; qualify seekability, descriptor length/offset and the native engine’s file-descriptor or read-callback support. Some document providers stream through a pipe and cannot support `mmap`. In that case choose a seekable provider or an explicitly disclosed local materialization. Record that materialization as a second disk copy: it saves network bytes but does not meet the single-copy storage promise. Keep descriptors open for the native consumer’s full lifetime and perform hashing/inference off the UI thread.

### 14.3 Apple mobile and sandboxed macOS

Apps from the same Apple development team can share an entitled App Group container. Multiple brands may use that group, but unrelated signing teams do not gain access by compiling the same group name or storage scope. Resolve the container with `containerURL(forSecurityApplicationGroupIdentifier:)`; do not derive its physical path. Both provisioning and runtime access must succeed. [Apple App Groups](https://developer.apple.com/documentation/xcode/configuring-app-groups)

For cross-team exchange, use explicit document-picker/File Provider access and security-scoped URLs/bookmarks where supported. Each app needs its own authorization. A read-in-place grant may avoid copying, while an import operation often creates an app-private copy; expose the distinction in the adapter result. Balance `startAccessingSecurityScopedResource` with `stopAccessingSecurityScopedResource`, coordinate document reads, handle stale bookmarks/revocation, and respect provider availability. iOS remains outside Natally’s currently committed four-target release matrix; this section is ecosystem architecture, not an expansion of Natally’s release scope. [Apple document access](https://developer.apple.com/documentation/uikit/providing-access-to-directories)

### 14.4 Browser and PWA

Cache Storage, IndexedDB and OPFS are scoped by origin/storage key. An identical scope string or `cacheName` on two unrelated domains cannot make their files visible to each other; CORS permits network access, not direct access to another origin’s OPFS. A same-origin suite can deliberately share its catalogue and object store, using a stable path layout and appropriate service-worker control. Same-origin reuse also shares a security boundary, so it must be an explicit hosting choice. [OPFS](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system)

On supporting browsers, a user-selected directory/file handle provides an additional reuse path; each origin must obtain access. Test permission persistence, user-gesture requirements and engine random-access support. For unsupported mobile browsers, offer honest import/own-cache behavior. Third-party iframes and storage partitioning are not a reliable universal cross-brand broker. Do not claim one browser download is instantly visible to an installed Tauri app without a real bridge or selected file grant. [File System Access](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access)

Request persistent storage where available, inspect quota before acquiring new bytes, and treat eviction as recoverable. Store multi-GB content as streams/chunks; avoid assembling a whole-file ArrayBuffer just to hash or import it. Browser storage estimates are advisory, and “persistent” is not a backup. WebGPU support, cross-origin isolation for threads, quota, available memory and file-size limits are independent qualification checks. [Storage persistence](https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/persist)

## 15 Resolve existing content before downloading

Resolve the requested immutable catalogue revision and runtime compatibility, then search the authorized shared library first. Check other registered shared providers and permitted legacy/private caches before network acquisition. Reuse a verified exact digest and all required dependency files; a same-name file or a matching length is insufficient. A missing permission is a distinct result from missing bytes. Offer “Use existing library” or “Allow access”; do not silently start another multi-GB download after a denied or expired grant.

Acquire a lock keyed by scope plus digest, then repeat discovery inside the lock: two apps can arrive simultaneously. Only one writer reserves disk and downloads. Reuse validated partial chunks and validate HTTP Range/Content-Range plus the server’s revision; a changed ETag or non-range response must not append unrelated bytes. Hash the persisted full content, not only newly downloaded chunks. Verify expected size/digest and compatible metadata before exposing a committed object. Publish through the backend’s verified commit protocol; on failure preserve the old readable version. Filesystem rename semantics do not automatically apply to SAF, BlobStore or browser storage. SAF providers without cross-client coordination require a single cooperating writer/provider or an explicit weaker deduplication guarantee. A logical bundle becomes ready only when all required digests are available.

Read-only clients receive leases. Removing a model from one app removes that app’s reference; it does not erase shared bytes while other clients need them. Deletion/garbage collection belongs to the library owner, with active-reader protection, retention policy, recovery for crashed readers and an explicit user-facing scope. Natally’s “delete everything” should erase its private records and release its asset claims, not wipe another app’s ZIMs or models. Never trust stale reference counts alone; qualify lease expiry, offline consumers, crashed writers and uninstall behavior.

### 15.1 Build time configuration sample

The following samples are specification examples, not files already implemented in Natally. Proposed names must enter the entity table before dispatch. Use a single public configuration artifact generated by the owning build wrapper before both Vite and Cargo. That wrapper chooses `.env` mode once; frontend and Rust consume the same output. Do not read process environment at runtime or make storage scope a Settings switch. Keep secrets out of the generated file.

```dotenv
# Illustrative public identity shared by participating brands
VITE_STORAGE_SCOPE=shared-content-v1
```

```javascript
// Proposed scripts/generate-storage-config.mjs; run from repository root.
import { loadEnv } from "vite";
import { mkdirSync, writeFileSync } from "node:fs";
const mode = process.argv[2];
if (!mode) throw new Error("Build mode is required");
const scope = loadEnv(mode, process.cwd(), "VITE_").VITE_STORAGE_SCOPE;
if (!scope || !/^[a-z0-9][a-z0-9_-]{2,63}$/.test(scope)) {
  throw new Error("Invalid VITE_STORAGE_SCOPE");
}
mkdirSync("config", { recursive: true });
writeFileSync("config/asset-storage.generated.json",
  JSON.stringify({ schema: 1, scope }) + "\n");
```

```typescript
// Proposed apps/local/src/storage/build-config.ts; Vite bundles this JSON.
import config from "../../../../config/asset-storage.generated.json";
export const storageScope: string = config.scope;
```

```rust
// Proposed apps/local/src-tauri/src/storage_config.rs.
#[derive(serde::Deserialize)]
pub struct StorageBuildConfig { pub schema: u32, pub scope: String }
pub fn storage_build_config() -> Result<StorageBuildConfig, serde_json::Error> {
    serde_json::from_str(include_str!(
        "../../../../config/asset-storage.generated.json"))
}
```

The frontend example’s relative path must resolve from the specified file to the repository-level `config` directory; the build must fail if generation or parity fails. Add `cargo:rerun-if-changed` for that JSON to the existing build script without replacing its plugin generation. Validate the scope and schema in the generator and native initialization. Run generation and packaging under the existing release lock so concurrent differently branded builds cannot overwrite each other’s generated configuration. Prefer isolated build directories for concurrent variants; preserve generated configuration with the build provenance. This example uses the existing Vite environment loader; it does not introduce a second `.env` parser.

### 15.2 Shared first resolver sample

This complete orchestration example intentionally depends on a platform adapter contract. It returns permission and integrity outcomes directly; it does not mock a successful download or implement the native provider. `lookup` checks shared providers first, then authorized legacy/private caches; it returns `missing` only when all configured usable sources have been examined. `acquire` returns a read lease only after persisted bytes are verified and atomically published. Both methods receive cancellation.

```typescript
type Asset = { sha256: string; bytes: number };
type Lease = { locator: string; release(): Promise<void> };
type Lookup =
  | { kind: "ready"; lease: Lease }
  | { kind: "missing" }
  | { kind: "needs-grant" | "unavailable" | "corrupt"; reason: string };
interface SharedAssets {
  lock<T>(key: string, run: () => Promise<T>): Promise<T>;
  lookup(asset: Asset, signal: AbortSignal): Promise<Lookup>;
  acquire(asset: Asset, signal: AbortSignal): Promise<Lease>;
}
export async function resolveExistingFirst(
  scope: string, asset: Asset, store: SharedAssets, signal: AbortSignal,
): Promise<Lookup> {
  if (!/^[a-z0-9][a-z0-9_-]{2,63}$/.test(scope) ||
      !/^[a-f0-9]{64}$/.test(asset.sha256) ||
      !Number.isSafeInteger(asset.bytes) || asset.bytes < 0) {
    throw new Error("Invalid shared asset identity");
  }
  signal.throwIfAborted();
  const found = await store.lookup(asset, signal);
  if (found.kind !== "missing") return found;
  return store.lock<Lookup>(`${scope}:${asset.sha256}`, async () => {
    signal.throwIfAborted();
    const again = await store.lookup(asset, signal);
    if (again.kind !== "missing") return again;
    return { kind: "ready", lease: await store.acquire(asset, signal) };
  });
}
```

`locator` is an opaque adapter token in this minimal example, never an unvalidated path supplied by web content. A production IPC contract must represent native path/descriptor, URI, bookmark and browser stream capabilities explicitly, constrain reads to granted library objects, and release resources on cancellation/unload. Locks must coordinate every participating app: a JS mutex or origin-local Web Lock cannot serialize unrelated native processes or web origins.

### 15.3 Android and Apple access samples

```kotlin
// In the ACTION_OPEN_DOCUMENT_TREE result handler, after a successful result.
val tree = resultData.data ?: error("No library selected")
val allowed = resultData.flags and (
    Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
require(allowed and Intent.FLAG_GRANT_READ_URI_PERMISSION != 0)
contentResolver.takePersistableUriPermission(tree, allowed)
// Save tree.toString() in this app's private settings, then resolve document IDs.
// For a resolved document URI, retain this descriptor until native reading ends.
val descriptor = contentResolver.openFileDescriptor(documentUri, "r")
    ?: error("Library object is unavailable")
// Do not convert documentUri to a filesystem path. Close descriptor after use.
```

```swift
import Foundation
enum LibraryAccessError: Error { case missingAppGroup }
func sharedLibrary(group: String, scope: String) throws -> URL {
    guard let root = FileManager.default.containerURL(
        forSecurityApplicationGroupIdentifier: group
    ) else { throw LibraryAccessError.missingAppGroup }
    return root.appendingPathComponent(scope, isDirectory: true)
}
// group must match the app's signed entitlement; scope comes from build config.
// Directory creation, coordination and verified publication belong to its owner.
```

These access fragments require their documented surrounding platform callback or entitlement setup. They do not establish that a returned descriptor supports seeking/mapping or that a directory contains a verified compatible model. Native compile/device verification remains part of the platform task. Errors must return a grant/unavailable state through the common resolver rather than trigger an undisclosed duplicate download.

## 16 Mapping the proposal to Natally implementation

CodeGraph supplied source-level evidence; Git blob comparisons established where the inspected donor files were identical to Cascade. Markdown contracts are outside the graph parser and were read directly. The table describes implementation at the audited snapshot, not a claim that every path has been exercised in a packaged application.

| Existing entity and source | Observed behavior | Required integration decision |
| --- | --- | --- |
| `MirrorStorage`, `WebMirrorStorage` in `apps/local/src/mirror/cache.ts:4` and `:54` | Streaming partials, locks, verified-publication seam; cache defaults to `natally-model-mirror-v1`, origin-rooted `/__model_mirror__/`; keys include asset ID, hash and bytes. | Preserve this seam. Introduce shared discovery/access and digest aliases without invalidating existing caches. Identical bytes under different current IDs do not automatically deduplicate. |
| `MirrorDownloader.download`, `apps/local/src/mirror/download.ts:158` | Checks `isPresent` inside its lock before network fetch; validates ranges and hashes persisted full bytes before commit. | Extend lookup to authorized shared locations. Preserve resume, cancellation and integrity semantics. Metadata-only `isPresent` requires a trusted immutable writer or revalidation against tampering. |
| `ModelCatalogue.remove`, `apps/local/src/mirror/catalogue.ts:131` | Current removal delegates to storage removal for an asset ID. | Replace shared deletion with release-of-claim plus library-owned collection before enabling cross-app reuse. |
| `loadRuntimeConfig`, `apps/local/src/config.ts:11` | Current input list has model mirror URL and app identity, no storage-scope input. | Wire one build-selected scope through generated public config and native construction; a new `.env` line alone has no effect. |
| Native lore opening, `packages/lore/native/lore_commands.rs:218` | Opens app data directory plus `natally.sqlite3`. | Keep this personal database private; do not relocate it into the shared public object store. |
| `apps/local/src/data/db.ts`; `packages/lore/src/store/web-sqlite.ts` | App repositories share the lore database/migrations; browser backend has filename/OPFS/IDB handling. | Separate immutable public packs from mutable per-user facts. Migration must preserve person/session/chart/turn IDs and provenance. |
| Native inference under `apps/local/src-tauri/src/inference/` | Source exists; model loading enforces containment under its supplied root and currently sets GPU layers to zero. Native registration path lacks the inference plugin. | I.2/I.3 must mount and qualify native inference. Extend only authorized roots/handles; do not remove containment checks. A built APK does not prove this lane works. |
| Manifest asset schema, `packages/billing/src/types.ts:101` | Closed kinds are `llm`, `embedder`, `voice`, `voices`. | ZIM/public-lore bundle kinds, dependency graphs and access locators require explicit schema/decision amendment; they are not existing Natally support. |

Natally’s shared storage is therefore a well-defined extension opportunity, not an already implemented ecosystem feature. The imported implementation is retained. The remaining work is to formalize new public-asset scope/discovery and platform adapters while preserving current private data, mirror checks, entitlement boundaries and composition.

## 17 Runner decisions and qualification

Keep Natally’s current local default **Qwen3.5-2B Q4_K_M** from architecture section 18.3. The 0.8B row remains debug-only; LFM2.5-2.6B remains stability-gated; Bonsai remains conditional on actual resource/backend qualification. Ordinary desktop users should receive an automatic usable choice, including on integrated graphics, without questions about CUDA or VRAM. The original generic 3B–4B/WebLLM roadmap does not supersede this product contract.

| Target | Continue from current contract | Qualification required |
| --- | --- | --- |
| Windows and Linux local | Tauri 2, linked native llama.cpp direction, native Kokoro/audio | Mounted command path; exact model/kernel support; streaming/cancel; peak memory alongside lore and voice; packaged execution. |
| Android local | Linked native engine with Rust/C++ and required Kotlin/JNI glue | Real device lifecycle, descriptor/seekable storage access, audio, cancellation, sustained thermals and memory. |
| Local browser/PWA | Current pinned wllama worker and ONNX Runtime Web Kokoro | Exact installed version, context/model format, isolation/thread fallback, quota, asset-size limits and real inference. |
| Hosted edition | Same UI and client-side lore; planned OpenRouter free/default and configured fallbacks | H.1/H.2 implementation and provider-specific behavior; hosted speech services are not selected by this document. |
| Future engines or iOS | LiteRT-LM/WebLLM/other backends remain candidates; iOS outside current release scope | Explicit decisions, local SDK snapshots, exact entities and one-task ownership before implementation; target evidence before promotion. |

Tauri shell sidecars are not a portable Android/iOS inference plan: the shell plugin’s mobile support is URL opening. Use the mobile plugin/FFI boundary for native work and keep long operations off Android’s main thread. [Tauri shell](https://v2.tauri.app/plugin/shell/#supported-platforms) and [mobile plugins](https://v2.tauri.app/develop/plugins/develop-mobile/)

Current upstream wllama documentation now describes WebGPU in V3 and default GPU offload in V3.1. That does not prove Natally’s pinned version includes it. Avoid a blanket “wllama is CPU-only” claim or automatic replacement with WebLLM; qualify the installed version. wllama also documents file-size/splitting and threading constraints. LiteRT-LM’s interface maturity varies: its overview labels Kotlin/C++ stable and Swift/JavaScript early preview. Neither headline establishes universal production parity. [wllama](https://github.com/ngxson/wllama) and [LiteRT-LM](https://developers.google.com/edge/litert-lm/overview)

Weight formats such as Q4_K_M/IQ4_XS, KV-cache types such as q8_0/q4r8, and Kokoro q8 are three different things. TurboQuant evidence concerns cache compression, not a guarantee of model-weight compatibility or universal q4r8 kernels. Retain D16’s engine gate and exact supporting runtime revision. Browser threads require isolation headers and appropriate builds independently of WebGPU availability. Self-host matching runtime JS/WASM and model assets. [TurboQuant](https://arxiv.org/abs/2504.19874), [llama.cpp cache types](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md), [Emscripten threads](https://emscripten.org/docs/porting/pthreads.html), [ONNX web deployment](https://onnxruntime.ai/docs/tutorials/web/deploy.html)

## 18 GLM 5 3 handoff and acceptance

**Start here:** run `/sesh resume` from the Cascade checkout, refresh applicable Admin-Manual conventions, and fingerprint the current Git state. The September 16 workflow belongs to GLM-5.3 but has already-completed stages. Use the current `DOCS/DECISIONS.md`, amended `DOCS/ARCHITECTURE.md`, `CHECKLIST.md` and `DOCS/TEST_RUBRIC.md`. The donor layer is already an ancestor: do not replay M0/M1, bulk-copy Desktop over Cascade, regenerate old markers or overwrite another worker’s pending registry implementation.

The following read-only commands reproduce the reconciliation decision. The fixed audited commit prevents concurrent HEAD advancement from changing the historical comparison; separately inspect current HEAD before executing any new task. A successful ancestry check prints `donor already incorporated`; `rev-list` at the audited pair returns `28 0`. If future Desktop work appears, capture only that new delta with its provenance and assign it to the appropriate current task. B.5c is currently an unchecked one-line ownership block without Do/Verify/Accept; its two untracked files therefore cannot be certified complete from that contract. Preserve the worker’s output and complete the task contract before independent attestation. A fresh GitHub fetch confirmed committed master divergence `0 / 0`; no completed committed task was waiting for a GitHub push at that check.

```bash
cd /home/robin/CascadeProjects/natally
git rev-parse --show-toplevel
git branch --show-current
git status --short --untracked-files=all
git merge-base --is-ancestor d011b6c aba35cc && echo 'donor already incorporated'
git rev-list --left-right --count aba35cc...d011b6c
git show --no-patch --format='%H%n%P%n%s' bf2f717
git -C /home/robin/Desktop/devProjects/natally status --short --untracked-files=all
```

| Sequence | Concrete next action | Evidence or acceptance |
| --- | --- | --- |
| 1 Retention | Record 146/146 preservation paths retained; investigate only a specific missing behavior against the original audit. | Ancestry and complete path/blob comparison; no second merge required for this donor tip. |
| 2 Current execution | Continue assigned current tasks; B.5c is already present as uncommitted work, so reconcile ownership first. Track native I.2/I.3, V.1, remaining UI/hosted/build work by their current blocks. | Exact task files and existing Verify/Accept; observed outcomes recorded. No duplicate worker on occupied files. |
| 3 Storage specification | Amend decisions, entity table and rubric with scope generation, catalogue identity, platform grants, typed locators, leases and public/private boundaries. Specify concrete paths/signatures and durable task checks before coder dispatch. | Every new enum/field and adapter has an owner; two coders receive the same complete contract. This report alone is not a replacement checklist. |
| 4 Storage integration | Extend M.1/config/I.2/I.3 first, then route model/voice/embed consumers through the resolver; add ZIM support only through an approved schema/product task. | Existing verified downloads remain readable, shared hits cause zero network bytes, personal databases remain isolated. |
| 5 Validation | Run the cases below and the actual TEST_RUBRIC on working artifacts. Record device/runtime/version, timecodes and evidence paths. | No marker, mock runner, compile-only success or old commit message substitutes for demonstrated behavior. |
| 6 Sole-head close-out | Verify outbox preservation, add donor relocation marker, update APP_INVENTORY/PORTFOLIO disposition without changing rankings, and publish scoped commits. | Cascade remains the only development head; donor remains preserved; report copies match; actual push results recorded. |

Storage validation must demonstrate: app A downloads once and differently branded app B reuses the same digest with zero network transfer; same name/different digest never aliases; existing content with revoked permission requests access before any download; simultaneous acquisition yields one published object; interrupted downloads resume safely; corrupt or truncated files cannot load; bundle dependency failure cannot produce a ready model; runner-incompatible bytes select a qualified variant without mislabelling it a cache miss; app A uninstall/removal leaves B’s leased content usable; private-data deletion leaves other apps’ public assets and private data intact; browser origin isolation and Android/Apple grant boundaries behave as documented; changing build scope changes only the intended compiled discovery policy and preserves existing data through an explicit migration.

**Publication and limits:** GitHub `master` was observed at `aba35cc` during inspection. Forgejo access attempts failed/timed out during this session; do not infer future availability from this note. Admin-Manual refresh failed connecting to its configured origin; local revision `bf55727d743b64c23583966845abc51295a7cada` supplied conventions. Application source, donor tree, remotes, credentials, version files and registry records were not changed by this documentation task. The lifecycle/deletion and shared-storage cases above are proposed qualification requirements, not reported passes.

**Source trail:** [continued ChatGPT conversation](https://chatgpt.com/share/6aabd4a1-2284-83ea-9832-4578172393d0); original DOCX SHA-256 `209c30205aef5c5aa6cdc1a75e53e303459784264c01f3a2d97d8b377fa051ff`; `DOCS/natally-reconciliation-report-16sep2026-20h30.md`; `DOCS/workflow_natally-full-app-v2.md`; `DOCS/ANALYSIS-REPORT-2026-09-13-v1.13.21288.md`; both September 12 implementation reports; current decisions/architecture/checklist/rubric. Original report and workflow claims retain their dates. This Markdown is the editable document source; the augmented DOCX is its presentation view with the original Word body retained. Byte-identical report copies belong under `~/Admin-Manual/PROJECTS/natally/`.
