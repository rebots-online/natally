// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FirstLight } from "./FirstLight.js";

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

const fill = (id: string, value: string) => {
  const field = document.querySelector(id);
  if (!field) throw new Error(`missing ${id}`);
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
  setter?.call(field, value);
  fireEvent.input(field);
  fireEvent.change(field);
};

afterEach(cleanup);

describe("FirstLight intake", () => {
  it("keeps Begin disabled until name, date, time and a gazetteer place are all real", () => {
    render(<FirstLight gazetteer={places} busy={false} error={null} onCreate={vi.fn()} />);
    const begin = screen.getByRole("button", { name: "Begin" });
    expect((begin as HTMLButtonElement).disabled).toBe(true);
    fill("#first-light-name", "Robin");
    fill("#first-light-date", "1990-05-02");
    fill("#first-light-time", "14:32");
    fill("#first-light-place", "Malmö, SE");
    expect((begin as HTMLButtonElement).disabled).toBe(false);
  });

  it("accepts an unknown birth time without a time value and submits the draft", async () => {
    const onCreate = vi.fn();
    render(<FirstLight gazetteer={places} busy={false} error={null} onCreate={onCreate} />);
    fireEvent.click(screen.getByRole("checkbox"));
    fill("#first-light-name", "Robin");
    fill("#first-light-date", "1990-05-02");
    fill("#first-light-place", "New York, US");
    fireEvent.click(screen.getByRole("button", { name: "Begin" }));
    await waitFor(() =>
      expect(onCreate).toHaveBeenCalledWith({
        name: "Robin",
        date: "1990-05-02",
        time: null,
        unknownTime: true,
        placeId: "us-nyc",
      }),
    );
  });

  it("rejects a place that is not from the gazetteer (no invented coordinates)", () => {
    render(<FirstLight gazetteer={places} busy={false} error={null} onCreate={vi.fn()} />);
    fill("#first-light-name", "Robin");
    fill("#first-light-date", "1990-05-02");
    fill("#first-light-time", "14:32");
    fill("#first-light-place", "Atlantis, NO");
    expect((screen.getByRole("button", { name: "Begin" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it("surfaces the composition's error honestly", () => {
    render(
      <FirstLight
        gazetteer={places}
        busy={false}
        error="Persistent storage is unavailable"
        onCreate={vi.fn()}
      />,
    );
    expect(screen.getByRole("alert").textContent).toContain("Persistent storage");
  });
});
