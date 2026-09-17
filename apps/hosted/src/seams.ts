// ARCHITECTURE §1 (D22): the hosted edition selects its services behind shared
// interfaces. These are the EMPTY seams — interfaces only, no implementations.
// Tasks H.2–H.4 fill them; nothing here may grow an implementation early.
import type { ConsumeResult, Reading } from "@natally/billing";

/** Chat message carried to the hosted inference lane (FenceMessage-shaped). */
export interface HostedInferenceMessage {
  readonly role: "system" | "user" | "assistant";
  readonly content: string;
}

/** D22: hosted companion inference — prompt + conversation context in, streamed tokens out. */
export interface HostedInference {
  complete(
    prompt: string,
    context: readonly HostedInferenceMessage[],
    onToken: (token: string) => void,
  ): Promise<void>;
  dispose(): Promise<void>;
}

/** D22: §10 envelope semantics — start/level/end frames reported alongside real PCM. */
export type HostedVoiceEvent =
  | { type: "envelope-start" }
  | { type: "envelope-level"; level: number }
  | { type: "envelope-end" };

/** D22: hosted voice generation — text in, PCM (plus envelope events) out. */
export interface HostedVoice {
  synthesize(
    text: string,
    onEvent: (event: HostedVoiceEvent) => void,
  ): Promise<{ readonly pcm: Float32Array; readonly sampleRate: number }>;
}

/** D22: hosted speech recognition — audio in, transcript text out. */
export interface HostedSpeech {
  transcribe(audio: Float32Array, sampleRate: number): Promise<string>;
}

/** D22: hosted billing gate — `packages/billing` ConsumeResult-shaped seam (§8.6). */
export interface HostedBilling {
  consume(reading: Reading): Promise<ConsumeResult>;
}
