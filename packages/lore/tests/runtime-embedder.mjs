// Real browser inference harness: node packages/lore/tests/runtime-embedder.mjs
// Only serves these task/model/runtime assets, on loopback; installs nothing.
import { createHash } from "node:crypto";
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const modelPath =
  process.argv[2] ?? "/home/robin/outbox/natally/model-mirror-source/all-minilm-l6-v2-q8_0.gguf";
const expectedHash = "263215c3cadd6e16740741a7624ab4cbb6c8e777688bd5331ecfbf5681c2f8ed";
const modelHash = createHash("sha256").update(readFileSync(modelPath)).digest("hex");
if (statSync(modelPath).size !== 25008064 || modelHash !== expectedHash) {
  throw new Error("The L.2 runtime fixture must be the approved, exact MiniLM GGUF");
}
const sdkRoot = new URL("../node_modules/@wllama/wllama/", import.meta.url);
let sdkPackage;
try {
  sdkPackage = JSON.parse(readFileSync(new URL("package.json", sdkRoot), "utf8"));
} catch (error) {
  throw new Error("Cannot read the installed wllama package metadata", { cause: error });
}
if (sdkPackage.version !== "3.6.1") throw new Error("Harness requires approved wllama 3.6.1");
const source = readFileSync(new URL("../src/embed/embedder.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const files = new Map([
  ["/sdk.js", fileURLToPath(new URL("esm/index.js", sdkRoot))],
  ["/wllama.wasm", fileURLToPath(new URL("esm/wasm/wllama.wasm", sdkRoot))],
  ["/model.gguf", modelPath],
]);
// Compatibility resources are unnecessary for the observed Chrome/JSPI run.
// Parent can supply the installed matching package to also exercise Safari.
const compatRoot = new URL("../node_modules/@wllama/wllama-compat/wasm/", import.meta.url);
for (const [route, name] of [
  ["/compat.wasm", "wllama.wasm"],
  ["/compat.js", "wllama.js"],
]) {
  const path = fileURLToPath(new URL(name, compatRoot));
  if (existsSync(path)) files.set(route, path);
}
const page = `<!doctype html><meta charset="utf-8"><title>L.2 real embedding verification</title>
<h1>L.2 real embedding verification</h1><pre id="result">Loading the verified MiniLM GGUF…</pre>
<script type="module">
import { createWebEmbedder } from "/embedder.js";
const output = document.querySelector("#result");
const embedder = createWebEmbedder({
  dim: 384,
  assets: {
    modelUrl: new URL("/model.gguf", location.href).href,
    wasmUrl: new URL("/wllama.wasm", location.href).href,
    compat: { wasm: "/compat.wasm", worker: "/compat.js" },
  },
  loadWllama: () => import("/sdk.js"),
});
try {
  const texts = ["The cat is sitting on the mat.", "A kitten rests on a rug.", "Database indexes speed up SQL queries."];
  const vectors = await Promise.all(texts.map(text => embedder.embed(text)));
  const repeat = await embedder.embed(texts[0]);
  const norms = vectors.map(vector => Math.hypot(...vector));
  const dot = (a, b) => a.reduce((sum, value, i) => sum + value * b[i], 0);
  const related = dot(vectors[0], vectors[1]);
  const unrelated = dot(vectors[0], vectors[2]);
  const repeatMaxError = Math.max(...repeat.map((value, i) => Math.abs(value - vectors[0][i])));
  if (!vectors.every(vector => vector.length === 384 && vector.every(Number.isFinite))) throw new Error("invalid dimension or component");
  if (!norms.every(norm => Math.abs(norm - 1) <= 1e-6)) throw new Error("L2 norm outside tolerance");
  if (!(related > unrelated)) throw new Error("related text must rank above unrelated text");
  if (repeatMaxError > 1e-6) throw new Error("repeat embedding drifted");
  await embedder.dispose();
  output.textContent = JSON.stringify({status: "PASS", sdk: "3.6.1", modelSha256: ${JSON.stringify(modelHash)}, dim: 384, texts, norms, related, unrelated, repeatMaxError, vectorHeads: vectors.map(vector => vector.slice(0, 4)), userAgent: navigator.userAgent}, null, 2);
} catch (error) {
  output.textContent = JSON.stringify({status: "FAIL", message: String(error), stack: error.stack}, null, 2);
  try { await embedder.dispose(); } catch {}
}
</script>`;
const server = createServer((request, response) => {
  response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  response.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
  response.setHeader("Cache-Control", "no-store");
  const path = new URL(request.url, "http://localhost").pathname;
  if (path === "/" || path === "/embedder.js") {
    response.setHeader("Content-Type", path === "/" ? "text/html" : "application/javascript");
    response.end(path === "/" ? page : compiled);
    return;
  }
  const file = files.get(path);
  if (!file) {
    response.writeHead(404);
    response.end("Not a harness asset");
    return;
  }
  response.setHeader(
    "Content-Type",
    path.endsWith(".js")
      ? "application/javascript"
      : path.endsWith(".wasm")
        ? "application/wasm"
        : "application/octet-stream",
  );
  response.setHeader("Content-Length", statSync(file).size);
  if (request.method === "HEAD") {
    response.end();
    return;
  }
  createReadStream(file).pipe(response);
});
server.listen(0, "127.0.0.1", () => {
  process.stdout.write(
    `${JSON.stringify({
      url: `http://127.0.0.1:${server.address().port}`,
      modelSha256: modelHash,
      sdk: sdkPackage.version,
    })}\n`,
  );
});
