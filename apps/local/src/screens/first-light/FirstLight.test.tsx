// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FirstLight, QUESTION_SEQUENCE } from "./FirstLight.js";

const places = [
  {
    id: "se-malmo",
    name: "Malmö",
    countryCode: "SE",
    lat: 55.6,
    lon: 13.0,
    tzid: "Europe/Stockholm",
  },
  {
    id: "us-nyc",
    name: "New York",
    countryCode: "US",
    lat: 40.7,
    lon: -74.0,
    tzid: "America/New_York",
  },
] as const;

const duplicatePlaces = [
  ...places,
  {
    id: "us-nyc-duplicate",
    name: "New York",
    countryCode: "US",
    lat: 43.0,
    lon: -75.0,
    tzid: "America/Detroit",
  },
] as const;

const prompts = [
  "What may I call you?",
  "When were you born?",
  "Where were you born?",
  "What time were you born?",
];

const field = (id: string): HTMLInputElement => {
  const element = document.querySelector<HTMLInputElement>(`#first-light-${id}`);
  if (!element) throw new Error(`missing first-light-${id}`);
  return element;
};

const fill = (id: string, value: string) => {
  fireEvent.change(field(id), { target: { value } });
};

const finishPrompt = (step: number) => {
  act(() => vi.advanceTimersByTime(55 * prompts[step].length));
};

const button = (name: string) => screen.getByRole<HTMLButtonElement>("button", { name });

const renderIntake = (onCreate = vi.fn()) =>
  render(<FirstLight gazetteer={places} busy={false} error={null} onCreate={onCreate} />);

const reachTime = () => {
  finishPrompt(0);
  fill("name", "Robin");
  fireEvent.click(button("Next"));
  finishPrompt(1);
  fill("date", "1990-05-02");
  fireEvent.click(button("Next"));
  finishPrompt(2);
  fill("place", "New York, US");
  fireEvent.click(button("Next"));
  finishPrompt(3);
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("FirstLight typewriter intake", () => {
  it("exports the four required questions in narrative order", () => {
    expect(QUESTION_SEQUENCE.map((question) => question.kind)).toEqual([
      "name",
      "date",
      "place",
      "time",
    ]);
    expect(QUESTION_SEQUENCE.map((question) => question.prompt)).toEqual(prompts);
  });

  it("hides inputs and actions until the last character then focuses the answer", () => {
    renderIntake();
    expect(document.querySelector("input")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    act(() => vi.advanceTimersByTime(55 * prompts[0].length - 1));
    expect(document.querySelector("input")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(document.activeElement).toBe(field("name"));
    expect(button("Next").disabled).toBe(true);
    fill("name", "Robin");
    fireEvent.click(button("Next"));
    expect(document.querySelector("input")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    finishPrompt(1);
    expect(document.activeElement).toBe(field("date"));
    expect(field("date").type).toBe("date");
  });

  it("reveals questions immediately when reduced motion is requested", () => {
    vi.mocked(window.matchMedia).mockImplementation((query: string) => ({
      matches: query.includes("prefers-reduced-motion"),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    renderIntake();
    expect(document.activeElement).toBe(field("name"));
    fill("name", "Robin");
    fireEvent.click(button("Next"));
    expect(document.activeElement).toBe(field("date"));
  });

  it("submits a known-time draft only after all four valid answers", () => {
    const onCreate = vi.fn();
    renderIntake(onCreate);
    reachTime();
    expect(document.activeElement).toBe(field("time"));
    expect(field("time").type).toBe("time");
    expect(button("Begin").disabled).toBe(true);
    fill("time", "14:32");
    fireEvent.click(button("Begin"));
    expect(onCreate).toHaveBeenCalledExactlyOnceWith({
      name: "Robin",
      date: "1990-05-02",
      time: "14:32",
      unknownTime: false,
      placeId: "us-nyc",
    });
  });

  it("disables time and submits null when birth time is unknown", () => {
    const onCreate = vi.fn();
    renderIntake(onCreate);
    reachTime();
    fill("time", "14:32");
    const unknown = screen.getByRole("checkbox");
    act(() => unknown.focus());
    fireEvent.click(unknown);
    expect(field("time").disabled).toBe(true);
    expect(document.activeElement).toBe(unknown);
    fireEvent.click(button("Begin"));
    expect(onCreate).toHaveBeenCalledExactlyOnceWith({
      name: "Robin",
      date: "1990-05-02",
      time: null,
      unknownTime: true,
      placeId: "us-nyc",
    });
  });

  it("rejects places absent from the gazetteer and accepts an actual match", () => {
    renderIntake();
    finishPrompt(0);
    fill("name", "Robin");
    fireEvent.click(button("Next"));
    finishPrompt(1);
    fill("date", "1990-05-02");
    fireEvent.click(button("Next"));
    finishPrompt(2);
    fill("place", "Atlantis, NO");
    expect(button("Next").disabled).toBe(true);
    expect(field("place").getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText("Choose a place from the suggestions.")).toBeTruthy();
    fill("place", "Malmö, SE");
    expect(button("Next").disabled).toBe(false);
    expect(field("place").getAttribute("aria-invalid")).toBeNull();
  });

  it("normalizes equivalent Unicode and disambiguates duplicate city labels", () => {
    const onCreate = vi.fn();
    const view = renderIntake(onCreate);
    finishPrompt(0);
    fill("name", "Robin");
    fireEvent.click(button("Next"));
    finishPrompt(1);
    fill("date", "1990-05-02");
    fireEvent.click(button("Next"));
    finishPrompt(2);
    fill("place", "Malmo\u0308, SE");
    expect(button("Next").disabled).toBe(false);

    view.rerender(
      <FirstLight gazetteer={duplicatePlaces} busy={false} error={null} onCreate={onCreate} />,
    );
    const values = Array.from(document.querySelectorAll("option"), (option) => option.value);
    expect(values).toContain("New York, US — America/New_York");
    expect(values).toContain("New York, US — America/Detroit");
  });

  it("preserves answers across Back navigation", () => {
    renderIntake();
    reachTime();
    fill("time", "14:32");
    fireEvent.click(button("Back"));
    finishPrompt(2);
    expect(field("place").value).toBe("New York, US");
    fireEvent.click(button("Back"));
    finishPrompt(1);
    expect(field("date").value).toBe("1990-05-02");
    fireEvent.click(button("Back"));
    finishPrompt(0);
    expect(field("name").value).toBe("Robin");
    fireEvent.click(button("Next"));
    finishPrompt(1);
    fireEvent.click(button("Next"));
    finishPrompt(2);
    fireEvent.click(button("Next"));
    finishPrompt(3);
    expect(field("time").value).toBe("14:32");
  });

  it("ignores repeated and composing Enter while allowing deliberate Enter", () => {
    renderIntake();
    finishPrompt(0);
    fill("name", "Robin");
    expect(fireEvent.keyDown(field("name"), { key: "Enter", repeat: true })).toBe(false);
    expect(field("name").value).toBe("Robin");
    fireEvent.compositionStart(field("name"));
    expect(fireEvent.keyDown(field("name"), { key: "Enter", isComposing: true })).toBe(false);
    expect(field("name").value).toBe("Robin");
    fireEvent.compositionEnd(field("name"));
    expect(fireEvent.keyDown(field("name"), { key: "Enter" })).toBe(true);
    const form = field("name").form;
    if (!form) throw new Error("missing intake form");
    // jsdom does not perform the browser default implicit submission on Enter.
    fireEvent.submit(form);
    finishPrompt(1);
    expect(document.activeElement).toBe(field("date"));
  });

  it("blocks duplicate submissions and busy interactions, then allows an error retry", () => {
    const onCreate = vi.fn();
    const view = renderIntake(onCreate);
    reachTime();
    fill("time", "14:32");
    const begin = button("Begin");
    fireEvent.click(begin);
    fireEvent.click(begin);
    expect(onCreate).toHaveBeenCalledTimes(1);
    view.rerender(<FirstLight gazetteer={places} busy={true} error={null} onCreate={onCreate} />);
    expect(field("time").disabled).toBe(true);
    expect(button("Back").disabled).toBe(true);
    fireEvent.keyDown(field("time"), { key: "Enter" });
    expect(onCreate).toHaveBeenCalledTimes(1);
    view.rerender(
      <FirstLight
        gazetteer={places}
        busy={false}
        error="Persistent storage is unavailable"
        onCreate={onCreate}
      />,
    );
    expect(screen.getByRole("alert").textContent).toContain("Persistent storage is unavailable");
    expect(field("time").value).toBe("14:32");
    fireEvent.click(button("Begin"));
    expect(onCreate).toHaveBeenCalledTimes(2);

    view.rerender(<FirstLight gazetteer={places} busy={true} error={null} onCreate={onCreate} />);
    view.rerender(
      <FirstLight
        gazetteer={places}
        busy={false}
        error="Persistent storage is unavailable"
        onCreate={onCreate}
      />,
    );
    expect(document.activeElement).toBe(field("time"));
    fireEvent.click(button("Begin"));
    expect(onCreate).toHaveBeenCalledTimes(3);
  });

  it("cleans up the active typing timer on unmount", () => {
    const view = renderIntake();
    act(() => vi.advanceTimersByTime(55));
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
    act(() => vi.runAllTimers());
  });
});
