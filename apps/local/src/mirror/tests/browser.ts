import { type ChildProcess, spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";

/** Minimal CDP transport using Node's installed WebSocket; no browser package download. */
export class FixtureBrowser {
  private process?: ChildProcess;
  private socket?: WebSocket;
  private sequence = 0;
  private sessionId?: string;
  private readonly pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();

  async start(url: string): Promise<void> {
    const profile = await mkdtemp(join(import.meta.dirname, "STAGING_chrome_"));
    this.process = spawn(
      process.env.MIRROR_TEST_CHROME ?? "/usr/bin/google-chrome",
      [
        "--headless=new",
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--disable-background-networking",
        "--disable-default-apps",
        "--no-first-run",
        "--no-default-browser-check",
        "--remote-debugging-port=0",
        `--user-data-dir=${profile}`,
        "about:blank",
      ],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    const endpoint = await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Chrome did not expose CDP within 15 seconds")),
        15_000,
      );
      let output = "";
      this.process?.stderr?.on("data", (chunk: Buffer) => {
        output += chunk.toString();
        const match = /DevTools listening on (ws:\/\/[^\s]+)/.exec(output);
        if (match) {
          clearTimeout(timeout);
          resolve(match[1]!);
        }
      });
      this.process?.once("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      this.process?.once("exit", (code) => {
        clearTimeout(timeout);
        reject(new Error(`Chrome exited (${code}): ${output.slice(-2000)}`));
      });
    });
    this.socket = new WebSocket(endpoint);
    await new Promise<void>((resolve, reject) => {
      this.socket?.addEventListener("open", () => resolve(), { once: true });
      this.socket?.addEventListener("error", () => reject(new Error("CDP connection failed")), {
        once: true,
      });
    });
    this.socket.addEventListener("message", (event) => {
      let message: unknown;
      try {
        message = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (
        typeof message !== "object" ||
        message === null ||
        !("id" in message) ||
        typeof message.id !== "number"
      )
        return;
      const request = this.pending.get(message.id);
      if (!request) return;
      this.pending.delete(message.id);
      if ("error" in message) request.reject(new Error(JSON.stringify(message.error)));
      else if ("result" in message) request.resolve(message.result);
      else request.reject(new Error("CDP response lacks result"));
    });
    this.socket.addEventListener("close", () => {
      for (const request of this.pending.values()) request.reject(new Error("CDP closed"));
      this.pending.clear();
    });
    const { targetId } = await this.send<{ targetId: string }>("Target.createTarget", { url });
    const attached = await this.send<{ sessionId: string }>("Target.attachToTarget", {
      targetId,
      flatten: true,
    });
    this.sessionId = attached.sessionId;
    await this.send("Runtime.enable");
    await this.evaluate(`new Promise(resolve => {
      if (document.readyState === "complete") resolve(true);
      else addEventListener("load", () => resolve(true), { once: true });
    })`);
  }

  private send<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: (value) => resolve(value as T), reject });
      this.socket?.send(JSON.stringify({ id, method, params, sessionId: this.sessionId }));
    });
  }

  async evaluate<T = unknown>(expression: string): Promise<T> {
    const result = await this.send<{
      result: { value?: T };
      exceptionDetails?: { exception?: { description?: string }; text: string };
    }>("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      throw new Error(
        result.exceptionDetails.exception?.description ?? result.exceptionDetails.text,
      );
    }
    return result.result.value as T;
  }

  async close(): Promise<void> {
    this.socket?.close();
    if (!this.process || this.process.exitCode !== null) return;
    const process = this.process;
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        process.kill("SIGKILL");
      }, 3000);
      process.once("exit", () => {
        clearTimeout(timeout);
        resolve();
      });
      process.kill("SIGTERM");
    });
    // Profiles are isolated, ignored, and retained for failed-run diagnosis (no /tmp).
  }
}
