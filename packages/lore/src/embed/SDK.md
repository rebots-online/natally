# L.2 embedding integration

Production exports from `embedder.ts`: `Embedder { readonly dim: number;
embed(text: string): Promise<number[]> }`, `WebEmbedder` (adds
`dispose(): Promise<void>`), `createWebEmbedder(options: WebEmbedderOptions):
WebEmbedder`, `createNativeEmbedder(options: NativeEmbedderOptions): Embedder`,
and `resolveEmbedDimension(value?: number | string): number`. Associated options,
mirror asset, SDK module/runtime, and invoke types are also exported. Add package
export `./embed` targeting `./src/embed/embedder.ts` in the parent integration.

`VITE_LORE_EMBED_DIM` defaults to 384. An explicit `dim` overrides it. Configuration
and model output must agree; no truncation or projection of production vectors.
Both adapters use mean sequence pooling and L2 normalization. Empty/blank/NUL text,
zero vectors, non-finite values and dimension mismatches reject. Errors never
substitute an alternative embedding. Store/bootstrap vectors must use the same
model, tokenizer, pooling and width as later retrieval; changing those requires
re-embedding the catalogue. A dimension match alone is insufficient.

## Web

Parent dependency: `@wllama/wllama` **3.6.1**, installed in app and lore by the parent.
The matching `@wllama/wllama-compat` runtime assets are also needed for Safari;
they were not present for the observed Chrome run. The parent owns acquiring and
mirroring those assets. Do not select a version from GitHub main's package.json.
Pass `loadWllama: () => import("@wllama/wllama/esm/index.js")`. Version 3.6.1's
package root advertises a missing `index.js`; the shipped ESM bundle is explicit.
The structural SDK boundary keeps
this package independent of app bundling and makes the JS import lazy as well as
the GGUF load. A real Wllama is constructed and its embedding API is called by
this implementation. Use one embedder instance per model and dispose it at shutdown.

Inject `assets.modelUrl` from the verified mirror GGUF, `assets.wasmUrl` from
the matching wllama package's `esm/wasm/wllama.wasm`, and
`assets.compat: { wasm, worker }` from matching self-hosted wllama-compat assets.
The app's mirror downloader owns SHA-256 verification and URL/path resolution.
No mirror filename or external fallback is guessed here. Runtime assets must
match the SDK version; a legacy wllama 2.x runtime is incompatible.

The parent must stage the compatibility WASM and worker for Safari; the constructor's
CDN compatibility default is overridden before loading. Serve the worker under an
origin/CSP that allows it; supply COOP/COEP headers for multithreading. The optional
`contextSize` defaults to 512 and sets the context, batch and microbatch together.

Installed 3.6.1 declarations are the API authority:

- `packages/lore/node_modules/@wllama/wllama/esm/wllama.d.ts`: constructor,
  `loadModelFromUrl`, `setCompat`, `createEmbedding`, `exit`.
- `packages/lore/node_modules/@wllama/wllama/esm/types/oai-compat.d.ts`:
  `EmbeddingCreateParams`, `CreateEmbeddingResponse`. The adapter explicitly
  requests `encoding_format: "float"`; the SDK return type still allows a base64
  string, which the adapter rejects as a non-vector.
- `packages/lore/node_modules/@wllama/wllama/esm/types/types.d.ts`: mean pooling
  and context/batch configuration. Typecheck this boundary with Bundler resolution;
  the package declarations use extensionless internal exports (NodeNext does not
  resolve its `esm/index.d.ts` barrel).

Official supplemental references (live documentation may be newer than 3.6.1):

- [Wllama methods, including embedding, model loading and setCompat](https://github.ngxson.com/wllama/docs/classes/Wllama.html)
- [Embedding load options](https://github.ngxson.com/wllama/docs/interfaces/LoadModelParams.html)
- [Compatibility asset fields](https://github.ngxson.com/wllama/docs/interfaces/WllamaCompat.html)

## Native

Parent Cargo dependencies: `llama-cpp-2 = "=0.1.155"` (vendored llama.cpp build)
and `tauri = "=2.11.5"` (the locally present version). The native build needs a C/C++
toolchain, CMake and libclang/bindgen prerequisites; parent owns build integration.
The implementation selects CPU inference explicitly; no platform GPU feature is
required by L.2.

Include `native.rs` as a module. Reuse the application's single initialized
`Arc<LlamaBackend>` (or initialize one at app setup). Construct
`LoreEmbedderState::new(backend, NativeEmbedderConfig { model_path, dim, context_size })`
and manage **`Arc<LoreEmbedderState>`** in Tauri. `model_path` is an absolute path to
the verified mirror GGUF; `dim` must equal the client configuration, and
`context_size` is `NonZeroU32`, normally 512. The model is loaded only on the first
valid request. Context size is capped to the model's training context; oversized
input fails instead of truncating. The model stays cached until state teardown.

Mount a `lore-embed` plugin with `natally_plugin!("lore-embed", [commands...], setup=...)`
from the parent's auto-discovered `src/plugins/<name>.rs`. Register `lore_embed`
and manage the state in that setup; parent owns command permissions/capabilities.
The JS adapter calls `invoke("plugin:lore-embed|lore_embed", { text, dim })`;
no model path crosses IPC.
The command returns `Result<Vec<f64>, String>` via `spawn_blocking`. The synchronous
`LoreEmbedderState::embed(&self, text: &str, dim: usize)` has the same result type.

- [llama-cpp-2 0.1.155 model API](https://docs.rs/llama-cpp-2/0.1.155/llama_cpp_2/model/struct.LlamaModel.html)
- [llama-cpp-2 context and pooled embeddings](https://docs.rs/llama-cpp-2/0.1.155/llama_cpp_2/context/struct.LlamaContext.html)
- [Official llama.cpp embedding execution](https://github.com/ggml-org/llama.cpp/blob/master/examples/embedding/embedding.cpp)

## Verification boundary

Run `pnpm vitest run packages/lore/tests/embed.test.ts`. These tests exercise real
normalization and the deterministic fixture, plus production adapter behavior at
controlled SDK/IPC boundaries. They do not execute WASM, a GGUF or the Rust bridge.
The parent must compile the included native module, run its embedded Rust tests,
and compare native mirror inference with the observed web run using the same text
and model.

Real web inference **observed PASS** on 2026-09-13 with installed wllama 3.6.1
in Chrome 152/Linux. Run `node packages/lore/tests/runtime-embedder.mjs` and open
the printed loopback URL. This serves only the task's adapter, installed runtime
and the approved model; it does not install packages or modify model files.
The harness verifies the 25,008,064-byte model's SHA-256 before serving it:
`263215c3cadd6e16740741a7624ab4cbb6c8e777688bd5331ecfbf5681c2f8ed`.
Source: second-state/All-MiniLM-L6-v2-Embedding-GGUF, revision
`544f204f2eaa2d71361ffc74d6df7170285b286a`, `all-MiniLM-L6-v2-Q8_0.gguf`.

Observed output: 384 dimensions; norms 1, 0.9999999999999997, 1; repeat maximum
absolute error 0; related-text cosine 0.622577369094986 versus unrelated-text
cosine 0.0020650522668310394. The runtime warned that `special_eos_id` was absent
from `special_eog_ids`, and that speculative decoding was unsupported. Neither
prevented these embedding assertions from passing. Safari/compatibility mode and
native inference remain unverified.
The observed output and warnings are preserved in
`packages/lore/tests/fixtures/minilm-wllama-3.6.1.observed.json`.

The hash fixture is exported only from `packages/lore/tests/hash-embedder.ts` as
`createHashEmbedder(dim = 384): Embedder`, for tests and M.1 bootstrap only. Its
dimensions are explicit and independent of production environment configuration.
