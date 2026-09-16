// natally — V.2 sentence-chunking fixtures. The rules are documented on
// `chunkSentences` (web.ts) and mirrored by the native leg; these fixtures pin
// the web leg's behavior: sentence punctuation splits, abbreviations are kept,
// and no break ever lands mid-word.
import { describe, expect, it } from "vitest";
import { chunkSentences } from "./web";

describe("voice web: chunking fixtures", () => {
  it("splits on sentence punctuation, keeping terminators attached", () => {
    expect(chunkSentences("Hello there. How are you? I am fine!")).toEqual([
      "Hello there.",
      "How are you?",
      "I am fine!",
    ]);
  });

  it("keeps honorific abbreviations (Dr., Mr.) glued to their sentence", () => {
    expect(chunkSentences("Dr. Smith met Mr. Jones. They talked.")).toEqual([
      "Dr. Smith met Mr. Jones.",
      "They talked.",
    ]);
  });

  it("keeps e.g. mid-sentence and still breaks at the next real sentence", () => {
    expect(chunkSentences("Use e.g. a marker. Then leave.")).toEqual([
      "Use e.g. a marker.",
      "Then leave.",
    ]);
  });

  it("keeps etc. conservatively joined (no false split after abbreviations)", () => {
    expect(chunkSentences("Bring pens, paper, etc. Then we left.")).toEqual([
      "Bring pens, paper, etc. Then we left.",
    ]);
  });

  it("never splits a decimal number (3.14 stays whole)", () => {
    expect(chunkSentences("Pi is 3.14 exactly. Yes.")).toEqual(["Pi is 3.14 exactly.", "Yes."]);
  });

  it("keeps single-letter initials together (J. R. R.)", () => {
    expect(chunkSentences("J. R. R. Tolkien wrote. Truly.")).toEqual([
      "J. R. R. Tolkien wrote.",
      "Truly.",
    ]);
  });

  it("keeps p.m. glued to its sentence", () => {
    expect(chunkSentences("At 3 p.m. we left. Late.")).toEqual(["At 3 p.m. we left.", "Late."]);
  });

  it("treats a run of terminators as one break (What?! stays whole)", () => {
    expect(chunkSentences("What?! Really?!")).toEqual(["What?!", "Really?!"]);
  });

  it("breaks after a terminator even without whitespace, never mid-word", () => {
    expect(chunkSentences("Wait!Don't stop.")).toEqual(["Wait!", "Don't stop."]);
  });

  it("drops punctuation-only fragments and empty input", () => {
    expect(chunkSentences("!!! Hi.")).toEqual(["Hi."]);
    expect(chunkSentences("")).toEqual([]);
    expect(chunkSentences("   \n\t  ")).toEqual([]);
  });
});
