// Browser-only supplement to token.test.ts. Serve this directory with Vite,
// configFile:false and envDir set here; open token-browser.html in a secure context.
// Synthetic keys/accounts only. Each run gets an isolated IndexedDB database.
import {
  denyListSigningInput,
  encodeBase64Url,
  licenseSigningInput,
  type VerifiableLicensePayload,
} from "../src/token/format.js";
import { WebTokenStorage, type WrappedValue } from "../src/token/storage-web.js";

const output = document.getElementById("results");
const lines: string[] = [];
function assert(value: boolean, name: string): void {
  if (!value) throw new Error(name);
  lines.push(`PASS ${name}`);
  if (output) output.textContent = lines.join("\n");
}
async function rejects(action: () => Promise<unknown>, message: string) {
  try {
    await action();
  } catch (error) {
    return error instanceof Error && error.message === message;
  }
  return false;
}

async function run() {
  const pair = (await crypto.subtle.generateKey("Ed25519", true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const publicKey = encodeBase64Url(
    new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey)),
  );
  const now = Math.floor(Date.now() / 1000);
  const mint = async (sub: string) => {
    const claims: VerifiableLicensePayload = {
      sub,
      tier: "unlimited",
      iat: now,
      exp: null,
      iss: "natally-license-bridge",
      jti: `jti:${sub}`,
    };
    const input = licenseSigningInput(claims);
    return `${input}.${encodeBase64Url(new Uint8Array(await crypto.subtle.sign("Ed25519", pair.privateKey, new TextEncoder().encode(input))))}`;
  };
  const databaseName = `STAGING_b3-token-browser-${crypto.randomUUID()}`;
  const settings = { databaseName, publicKey, now: () => now };
  const a = new WebTokenStorage(settings);
  const b = new WebTokenStorage(settings);
  const [alice, bob] = await Promise.all([mint("alice"), mint("bob")]);
  assert((await a.load("absent")) === null, "empty store is honest absence");
  await Promise.all([a.store(alice, "alice"), b.store(bob, "bob")]);
  assert(
    (await a.load("alice")) === alice && (await b.load("bob")) === bob,
    "concurrent storage instances share one key and retain both accounts",
  );
  await Promise.all([a.close(), b.close()]);
  const reopened = new WebTokenStorage(settings);
  assert(
    (await reopened.load("alice")) === alice && (await reopened.load("bob")) === bob,
    "tokens decrypt and verify after closing and reopening IndexedDB",
  );

  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  async function read<T>(storeName: string, id: string): Promise<T> {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, "readonly");
      const request = tx.objectStore(storeName).get(id);
      tx.oncomplete = () => resolve(request.result as T);
      tx.onabort = () => reject(tx.error);
    });
  }
  async function put(id: string, value: WrappedValue): Promise<void> {
    return new Promise((resolve, reject) => {
      const tx = db.transaction("values", "readwrite");
      tx.objectStore("values").put(value, id);
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error);
    });
  }
  const key = await read<CryptoKey>("keys", "wrapping-key");
  assert(
    key instanceof CryptoKey && !key.extractable && key.algorithm.name === "AES-GCM",
    "IndexedDB stores a nonextractable AES-GCM CryptoKey",
  );
  const context = "natally-license:v1:token:alice";
  const envelope = await read<WrappedValue>("values", context);
  assert(
    typeof envelope !== "string" &&
      envelope.ciphertext instanceof ArrayBuffer &&
      !new TextDecoder().decode(envelope.ciphertext).includes(alice),
    "persisted value contains ciphertext rather than a plaintext token",
  );
  await put(context, await read<WrappedValue>("values", "natally-license:v1:token:bob"));
  assert(
    await rejects(() => reopened.load("alice"), "storage-authentication-failed"),
    "swapping account records fails authentication",
  );
  await put(context, envelope);
  const tampered = structuredClone(envelope);
  const bytes = new Uint8Array(tampered.ciphertext);
  bytes[0] = (bytes[0] ?? 0) ^ 1;
  await put(context, tampered);
  assert(
    await rejects(() => reopened.load("alice"), "storage-authentication-failed"),
    "persisted ciphertext tampering fails authentication",
  );
  await put(context, envelope);

  const payload = { issuedAt: now, revokedJti: ["jti:alice"] };
  const signed = {
    payload,
    signature: encodeBase64Url(
      new Uint8Array(
        await crypto.subtle.sign("Ed25519", pair.privateKey, denyListSigningInput(payload)),
      ),
    ),
  };
  await reopened.writeDenyList(signed);
  await reopened.close();
  const restored = new WebTokenStorage(settings);
  assert(
    JSON.stringify(await restored.readDenyList()) === JSON.stringify(signed),
    "signed deny-list cache survives reopening",
  );
  await restored.clear("alice");
  assert(
    (await restored.load("alice")) === null && (await restored.load("bob")) === bob,
    "clear removes only the selected account",
  );
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("keys", "readwrite");
    tx.objectStore("keys").delete("wrapping-key");
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error);
  });
  assert(
    (await rejects(() => restored.load("bob"), "storage-key-unavailable")) &&
      (await rejects(() => restored.store(alice, "alice"), "storage-key-unavailable")),
    "a lost key fails explicitly without silently replacing existing encryption",
  );
  await restored.close();
  db.close();
  lines.push(`COMPLETE ${lines.length} browser assertions passed`);
  if (output) output.textContent = lines.join("\n");
}

void run().catch((error: unknown) => {
  if (output)
    output.textContent = `${lines.join("\n")}\nFAIL ${error instanceof Error ? error.message : String(error)}`;
});
