// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { URL as FileURL } from "node:url";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import version from "../../../../../version.json";
import { GLYPH_NAMES, Glyph, glyphSpriteUrl } from "../glyphs";
import { VersionStamp } from "../version";
import { Button, Chip, Composer, PlateCard, TopBar, TurnHer, TurnYou } from "./index";

const primitiveCSS = readFileSync(new FileURL("./primitives.css", import.meta.url), "utf8");
let theme: HTMLStyleElement;

beforeEach(() => {
  document.title = "Observatory test app";
  theme = document.createElement("style");
  theme.textContent = primitiveCSS;
  document.head.append(theme);
});
afterEach(() => {
  cleanup();
  theme.remove();
});

function cssRule(selector: string): CSSStyleDeclaration {
  if (!theme.sheet) throw new Error("Primitive stylesheet was not parsed.");
  const rule = Array.from(theme.sheet.cssRules)
    .reverse()
    .find(
      (entry) =>
        "selectorText" in entry &&
        (entry as CSSStyleRule).selectorText
          .split(",")
          .map((part) => part.trim())
          .includes(selector),
    );
  expect(rule, `CSS rule ${selector}`).toBeDefined();
  return (rule as CSSStyleRule).style;
}

describe("primitives: seven frozen Components-page components", () => {
  it("renders all seven with the shared dark theme and token-backed classes", () => {
    const tokenCSS = readFileSync(
      createRequire(import.meta.url).resolve("@natally/design-tokens/tokens.css"),
      "utf8",
    );
    // jsdom does not run Tailwind. Expose the actual @theme variables at :root,
    // preserving their values; this checks CSS wiring, not layout/raster parity.
    theme.textContent =
      tokenCSS.replace(/@import\s+[^;]+;/g, "").replace(/@theme(?:\s+[^{]+)?\s*\{/g, ":root {") +
      "\n" +
      primitiveCSS;
    const { container } = render(
      <div className="ui-shell" data-theme="dark">
        <Button variant="primary">Continue</Button>
        <Chip active>Current person</Chip>
        <TopBar onMenu={vi.fn()} context={<Chip>Context</Chip>} />
        <Composer value="" onChange={vi.fn()} onSend={vi.fn()} />
        <PlateCard title="Computed plate" provenance="Engine-provided provenance" onOpen={vi.fn()}>
          Computed data
        </PlateCard>
        <TurnHer>Generated transcript</TurnHer>
        <TurnYou>User transcript</TurnYou>
      </div>,
    );
    for (const name of ["button", "chip", "topbar", "composer", "plate", "turn-her", "turn-you"]) {
      expect(container.querySelector(`.ui-${name}`)).toBeInTheDocument();
    }
    expect(container.firstChild).toHaveAttribute("data-theme", "dark");
    const root = getComputedStyle(document.documentElement);
    for (const token of [
      "--color-midnight",
      "--color-vellum",
      "--color-gilt",
      "--color-orbglow",
      "--color-hairline",
      "--radius-button",
      "--radius-chip",
      "--radius-plate",
      "--radius-pill",
      "--size-touch",
      "--spacing-3",
      "--stroke-hairline",
    ]) {
      expect(root.getPropertyValue(token).trim(), token).not.toBe("");
      expect(primitiveCSS).toContain(`var(${token})`);
    }
    expect(cssRule(".ui-button--primary").getPropertyValue("background")).toBe("var(--color-gilt)");
    expect(cssRule(".ui-chip--active").getPropertyValue("border-color")).toBe(
      "var(--color-orbglow)",
    );
    expect(cssRule(".ui-composer").getPropertyValue("border-radius")).toBe("var(--radius-pill)");
    expect(cssRule(".ui-plate").getPropertyValue("background")).toBe("var(--color-midnight-2)");
    expect(cssRule(".ui-turn-you").getPropertyValue("border")).toContain("var(--color-orbglow)");
    expect(cssRule(".ui-turn-her").getPropertyValue("border")).toBe("");
    expect(cssRule(".ui-button:focus-visible").getPropertyValue("outline")).toContain(
      "var(--color-orbglow)",
    );
    expect(cssRule(".ui-button").getPropertyValue("min-height")).toBe("var(--size-touch)");
  });

  it("keeps button variants, native disabled behavior and chip selection accessible", async () => {
    const user = userEvent.setup();
    const click = vi.fn();
    const { rerender } = render(
      <>
        <Button variant="quiet" onClick={click}>
          Quiet action
        </Button>
        <Chip active>Person</Chip>
      </>,
    );
    await user.tab();
    expect(screen.getByRole("button", { name: "Quiet action" })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(click).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Person" })).toHaveAttribute("aria-pressed", "true");
    rerender(
      <Button disabled onClick={click}>
        Disabled action
      </Button>,
    );
    await user.click(screen.getByRole("button"));
    expect(click).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button")).toHaveAttribute("type", "button");
    expect(screen.getByRole("button")).toHaveClass("ui-button--secondary");
  });

  it("uses document.title in the top bar and attributes generated turns without canned copy", async () => {
    const onMenu = vi.fn();
    render(
      <>
        <TopBar
          onMenu={onMenu}
          menuId="main-navigation"
          menuOpen
          context={<Chip>Person context</Chip>}
        />
        <TurnHer streaming>Actual supplied text</TurnHer>
      </>,
    );
    expect(screen.getAllByText(document.title)).toHaveLength(2);
    const menu = screen.getByRole("button", { name: "Menu" });
    expect(menu).toHaveAttribute("aria-controls", "main-navigation");
    expect(menu).toHaveAttribute("aria-expanded", "true");
    await userEvent.setup().click(menu);
    expect(onMenu).toHaveBeenCalledOnce();
    expect(screen.getByRole("article")).toHaveAttribute("aria-busy", "true");
    expect(screen.getByText("Actual supplied text")).toHaveClass("ui-turn-her__body");
  });

  it("composes controlled text, submits on Enter, retains Shift+Enter and delegates real actions", async () => {
    const user = userEvent.setup();
    const send = vi.fn();
    const attach = vi.fn();
    const voice = vi.fn();
    function ControlledComposer() {
      const [value, setValue] = useState("");
      return (
        <Composer
          value={value}
          onChange={setValue}
          onSend={send}
          onAttach={attach}
          onVoice={voice}
          voiceActive
        />
      );
    }
    const { container } = render(<ControlledComposer />);
    expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled();
    expect(container.querySelectorAll(".ui-button--primary")).toHaveLength(1);
    await user.type(screen.getByRole("textbox", { name: "Message" }), "Hello");
    await user.keyboard("{Shift>}{Enter}{/Shift}there");
    expect(screen.getByRole("textbox")).toHaveValue("Hello\nthere");
    expect(send).not.toHaveBeenCalled();
    await user.keyboard("{Enter}");
    expect(send).toHaveBeenLastCalledWith("Hello\nthere");
    await user.click(screen.getByRole("button", { name: "Send message" }));
    expect(send).toHaveBeenCalledTimes(2);
    await user.click(screen.getByRole("button", { name: "Add attachment" }));
    await user.click(screen.getByRole("button", { name: "Voice input" }));
    expect(attach).toHaveBeenCalledOnce();
    expect(voice).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Voice input" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("does not submit IME composition, whitespace, or a disabled composer", () => {
    const send = vi.fn();
    const { rerender } = render(
      <Composer value="Pending composition" onChange={vi.fn()} onSend={send} />,
    );
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter", isComposing: true });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter", keyCode: 229 });
    expect(send).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Add attachment" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Voice input" })).toBeDisabled();
    rerender(<Composer value={" \n "} onChange={vi.fn()} onSend={send} />);
    fireEvent.submit(screen.getByRole("form"));
    rerender(<Composer value="Ready" disabled onChange={vi.fn()} onSend={send} />);
    fireEvent.submit(screen.getByRole("form"));
    expect(screen.getByRole("textbox")).toBeDisabled();
    expect(send).not.toHaveBeenCalled();
  });

  it("renders supplied plate content and provenance and opens the named plate", async () => {
    const onOpen = vi.fn();
    render(
      <PlateCard title="Natal chart" provenance="Computed provenance" onOpen={onOpen}>
        <output>Computed result</output>
      </PlateCard>,
    );
    expect(screen.getByRole("article", { name: "Natal chart" })).toBeInTheDocument();
    expect(screen.getByText("Computed provenance")).toHaveClass("ui-plate__provenance");
    await userEvent.setup().click(screen.getByRole("button", { name: "Open Natal chart" }));
    expect(onOpen).toHaveBeenCalledOnce();
  });
});

describe("glyph source and version stamp", () => {
  it("copies the sprite exactly and maps every canonical symbol without Unicode substitutions", () => {
    const original = readFileSync(
      new FileURL("../../../../../LIBS/UI/FIGMA/glyphs/natally-glyphs.svg", import.meta.url),
      "utf8",
    );
    const copy = readFileSync(
      new FileURL("../../assets/glyphs/natally-glyphs.svg", import.meta.url),
      "utf8",
    );
    // The asset copy may differ in header chrome (a11y <title>, comment indent — v1.12
    // review); the symbol payload must stay byte-identical to the frozen complement.
    const payload = (svg: string) => svg.slice(svg.indexOf("<symbol"));
    expect(payload(copy)).toBe(payload(original));
    expect(copy).toMatch(/<title>natally glyph definitions<\/title>/);
    const ids = [...copy.matchAll(/<symbol id="g-([^"]+)"/g)].map((match) => match[1]);
    expect([...GLYPH_NAMES]).toEqual(ids);
    const { container } = render(GLYPH_NAMES.map((name) => <Glyph key={name} name={name} />));
    container.querySelectorAll("use").forEach((element, index) => {
      expect(element).toHaveAttribute("href", `${glyphSpriteUrl}#g-${GLYPH_NAMES[index]}`);
    });
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(container.querySelector("svg")).toHaveAttribute("stroke", "currentColor");
    render(<Glyph name="sun" label="Sun" size={28} />);
    expect(screen.getByRole("img", { name: "Sun" })).toHaveAttribute("width", "28");
  });

  it("reads root version.json and keeps the micro stamp selectable and fixed bottom-right", () => {
    render(<VersionStamp />);
    const stamp = screen.getByLabelText(`Version ${version.version}`);
    expect(stamp).toHaveTextContent(`v${version.version}`);
    expect(stamp).not.toHaveTextContent(String(version.versionCode));
    const style = getComputedStyle(stamp);
    expect(style.position).toBe("fixed");
    expect(style.userSelect).toBe("text");
    expect(style.fontSize).toBe("11px");
    expect(style.lineHeight).toBe("14px");
    expect(cssRule(".ui-version").getPropertyValue("right")).toContain("var(--spacing-3)");
    expect(cssRule(".ui-version").getPropertyValue("bottom")).toContain("var(--spacing-2)");
  });
});
