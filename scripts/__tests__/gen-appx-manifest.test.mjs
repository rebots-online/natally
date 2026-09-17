// WP.2 — tests for scripts/gen-appx-manifest.mjs (architecture §20.3).
// Includes a small, real XML well-formedness checker (tokenizer + nesting +
// entity validation) — no regex-balance shortcut, no dependencies.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  escapeXml,
  generateManifest,
  selfTestFixture,
  substitute,
} from "../gen-appx-manifest.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const TEMPLATE = readFileSync(
  resolve(REPO_ROOT, "config/appx-template.xml"),
  "utf8",
);

// --- well-formedness checker -------------------------------------------------

const NAMED_ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
function decodeEntities(text) {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, body) => {
    if (body[0] === "#") {
      const code =
        body[1] === "x" || body[1] === "X"
          ? parseInt(body.slice(2), 16)
          : parseInt(body.slice(1), 10);
      if (!Number.isInteger(code) || code > 0x10ffff) throw new Error(`bad char ref &${body};`);
      return String.fromCodePoint(code);
    }
    if (!(body in NAMED_ENTITIES)) throw new Error(`undefined entity &${body};`);
    return NAMED_ENTITIES[body];
  });
}
function validateNameChars(text, where) {
  if (!/^[A-Za-z_:][A-Za-z0-9._:\-]*$/.test(text)) throw new Error(`invalid name "${text}" in ${where}`);
}

/** Parses an XML document and throws on any well-formedness violation. */
export function assertWellFormedXml(xml) {
  let i = 0;
  const stack = [];
  // XML or text prologue: optional BOM, decl, doctype, comments, whitespace.
  const prologue = /^\s*(?:<\?xml[\s\S]*?\?>)?\s*(?:<!--[\s\S]*?-->\s*)*(?:<!DOCTYPE[^>[\]]*(?:\[[^[\]]*\])?[^>]*>\s*)?/;
  const m = prologue.exec(xml);
  if (m) i = m[0].length;
  let sawContent = false;

  while (i < xml.length) {
    if (xml.startsWith("<!--", i)) {
      const end = xml.indexOf("-->", i + 4);
      if (end === -1) throw new Error("unterminated comment");
      if (xml.slice(i + 4, end).includes("--")) throw new Error("double-hyphen inside comment");
      i = end + 3;
    } else if (xml.startsWith("<![CDATA[", i)) {
      const end = xml.indexOf("]]>", i + 9);
      if (end === -1) throw new Error("unterminated CDATA");
      i = end + 3;
    } else if (xml.startsWith("<?", i)) {
      const end = xml.indexOf("?>", i + 2);
      if (end === -1) throw new Error("unterminated processing instruction");
      i = end + 2;
    } else if (xml[i] === "<") {
      if (xml.startsWith("</", i)) {
        const end = xml.indexOf(">", i);
        if (end === -1) throw new Error("unterminated end tag");
        const name = xml.slice(i + 2, end);
        validateNameChars(name, "end tag");
        const open = stack.pop();
        if (open === undefined) throw new Error(`end tag </${name}> with no open element`);
        if (open !== name) throw new Error(`mismatched end tag: expected </${open}>, got </${name}>`);
        i = end + 1;
        sawContent = true;
      } else {
        const end = xml.indexOf(">", i);
        if (end === -1) throw new Error("unterminated start tag");
        let inner = xml.slice(i + 1, end);
        let selfClosing = false;
        if (inner.endsWith("/")) {
          selfClosing = true;
          inner = inner.slice(0, -1);
        }
        const nameMatch = /^([^\s/>]+)/.exec(inner);
        if (!nameMatch) throw new Error("start tag without a name");
        validateNameChars(nameMatch[1], "start tag");
        // Attributes: name="value" or name='value'.
        const attrRe = /([^\s=/>]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
        let cursor = nameMatch[0].length;
        let attr;
        const seen = new Set();
        while ((attr = attrRe.exec(inner)) !== null) {
          // Reject junk between attributes (non-whitespace, non-attribute).
          const junk = inner.slice(cursor, attr.index);
          if (/[^\s]/.test(junk)) throw new Error(`malformed attribute region in <${nameMatch[1]}>: "${junk}"`);
          if (seen.has(attr[1])) throw new Error(`duplicate attribute ${attr[1]}`);
          seen.add(attr[1]);
          decodeEntities(attr[3] ?? attr[4] ?? "");
          cursor = attr.index + attr[0].length;
        }
        if (/[^\s/]/.test(inner.slice(cursor))) {
          throw new Error(`malformed attributes in <${nameMatch[1]}>: "${inner.slice(cursor)}"`);
        }
        if (!selfClosing) stack.push(nameMatch[1]);
        i = end + 1;
        sawContent = true;
      }
    } else {
      const next = xml.indexOf("<", i);
      const text = next === -1 ? xml.slice(i) : xml.slice(i, next);
      decodeEntities(text);
      if (next === -1) i = xml.length;
      else i = next;
      sawContent = true;
    }
  }
  if (stack.length > 0) throw new Error(`unclosed element(s): ${[...stack].join(", ")}`);
  if (!sawContent) throw new Error("no root element");
  return true;
}

// --- tests -------------------------------------------------------------------

const fixture = selfTestFixture();

function filledTemplate(values) {
  const { xml, unresolved } = substitute(TEMPLATE, values);
  expect(unresolved).toEqual([]);
  return xml;
}

describe("escapeXml", () => {
  it("escapes all five XML-special characters", () => {
    expect(escapeXml('&<>"\'')).toBe("&amp;&lt;&gt;&quot;&apos;");
  });
  it("leaves ordinary text alone", () => {
    expect(escapeXml("natally v1.0 (x64)")).toBe("natally v1.0 (x64)");
  });
});

describe("substitute", () => {
  it("resolves every token in the template with the fixture", () => {
    filledTemplate(fixture); // throws via expect if anything unresolved
  });
  it("reports unresolved tokens", () => {
    const { xml, unresolved } = substitute(TEMPLATE, { IDENTITY_NAME: "x" });
    expect(unresolved.length).toBeGreaterThan(0);
    expect(unresolved).toContain("PUBLISHER");
    expect(xml).toContain("@PUBLISHER@"); // left untouched
  });
});

describe("generated AppxManifest", () => {
  const xml = filledTemplate(fixture);

  it("is well-formed XML (real parser check)", () => {
    expect(assertWellFormedXml(xml)).toBe(true);
  });

  it("leaves no @…@ token behind", () => {
    expect(xml).not.toMatch(/@[A-Z0-9_]+@/);
  });

  it("declares full-trust packagedClassicApp at mediumIL", () => {
    expect(xml).toContain('EntryPoint="Windows.FullTrustApplication"');
    expect(xml).toContain("<desktop6:RunFullTrust />");
  });

  it("declares the runFullTrust capability", () => {
    expect(xml).toContain('<rescap:Capability Name="runFullTrust" />');
  });

  it("pins MinVersion=10.0.22000.0 and substitutes MaxVersionTested", () => {
    expect(xml).toContain('MinVersion="10.0.22000.0"');
    expect(xml).toContain(`MaxVersionTested="${fixture.MAX_VERSION_TESTED}"`);
  });

  it("substitutes identity, version, architecture and executable (escaped)", () => {
    expect(xml).toContain(`Name="${escapeXml(fixture.IDENTITY_NAME)}"`);
    expect(xml).toContain(`Publisher="${escapeXml(fixture.PUBLISHER)}"`);
    expect(xml).toContain(`Version="${fixture.VERSION}"`);
    expect(xml).toContain(`ProcessorArchitecture="${fixture.ARCHITECTURE}"`);
    expect(xml).toContain(`Executable="${escapeXml(fixture.EXECUTABLE)}"`);
  });
});

describe("escape-hostile values round-trip", () => {
  const hostile = {
    IDENTITY_NAME: 'Id&Co<Weird>"Quote"',
    PUBLISHER: "CN='Single & Double <Tag>>' Test",
    DISPLAY_NAME: 'natally & <the> "Companion"',
    PUBLISHER_DISPLAY_NAME: "Ben & Jerry's <Ice \"Cream\">",
    VERSION: "1&0<0>0\"0'",
    ARCHITECTURE: 'x&64"',
    EXECUTABLE: "natally & <friends>.exe",
    MAX_VERSION_TESTED: '10.0.22621&<>"\'',
  };
  const xml = filledTemplate(hostile);

  it("produces well-formed XML from hostile inputs", () => {
    expect(assertWellFormedXml(xml)).toBe(true);
  });

  it("every & inside an attribute is part of a valid entity (no raw specials)", () => {
    const entityOnly = /^(?:[^&<>"']|&(?:amp|lt|gt|quot|apos|#x[0-9a-fA-F]+|#\d+);)*$/;
    for (const m of xml.matchAll(/"([^"]*)"/g)) {
      expect(`${m[1]}\n`).toMatch(entityOnly);
    }
    for (const m of xml.matchAll(/'([^']*)'/g)) {
      expect(`${m[1]}\n`).toMatch(entityOnly);
    }
  });

  it("re-parses to the original values (round-trip)", () => {
    const roundTripped = (attr) =>
      decodeEntities(
        new RegExp(`${attr}="([^"]*)"`).exec(xml)[1],
      );
    expect(roundTripped("Name")).toBe(hostile.IDENTITY_NAME);
    expect(roundTripped("Publisher")).toBe(hostile.PUBLISHER);
    expect(roundTripped("Version")).toBe(hostile.VERSION);
    expect(roundTripped("ProcessorArchitecture")).toBe(hostile.ARCHITECTURE);
    expect(roundTripped("Executable")).toBe(hostile.EXECUTABLE);
    expect(roundTripped("MaxVersionTested")).toBe(hostile.MAX_VERSION_TESTED);
  });
});

describe("unresolved-token rejection", () => {
  it("throws and names every offending token", () => {
    let err;
    try {
      generateManifest({ template: TEMPLATE, values: { IDENTITY_NAME: "x" } });
    } catch (e) {
      err = e;
    }
    expect(err).toBeDefined();
    expect(Array.isArray(err.unresolvedTokens)).toBe(true);
    expect(err.unresolvedTokens).toEqual(
      expect.arrayContaining(["PUBLISHER", "VERSION", "ARCHITECTURE", "EXECUTABLE", "MAX_VERSION_TESTED"]),
    );
    expect(err.message).toContain("@PUBLISHER@");
  });
});

describe("CLI exit behavior", () => {
  it("exits 0 with values supplied on argv", async () => {
    const { main } = await import("../gen-appx-manifest.mjs?case=ok");
    const chunks = [];
    const orig = process.stdout.write.bind(process.stdout);
    process.stdout.write = (c) => { chunks.push(c); return true; };
    try {
      const code = main(["--check"], {});
      expect(code).toBe(0);
    } finally {
      process.stdout.write = orig;
    }
    const xml = chunks.join("");
    expect(assertWellFormedXml(xml)).toBe(true);
    expect(xml).toContain('Name="runFullTrust"');
  });

  it("exits non-zero and lists offending tokens when values are missing", async () => {
    const { main } = await import("../gen-appx-manifest.mjs?case=fail");
    const errs = [];
    const orig = process.stderr.write.bind(process.stderr);
    process.stderr.write = (c) => { errs.push(c); return true; };
    let code;
    try {
      code = main([], {});
    } finally {
      process.stderr.write = orig;
    }
    expect(code).not.toBe(0);
    expect(errs.join("")).toContain("@PUBLISHER@");
  });
});
