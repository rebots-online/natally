// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { type RouteRegistration, type RouteScreenProps, registerRoute } from "../router";
import NatallyShell from "../shell";

const unregister: Array<() => void> = [];
function register(route: RouteRegistration) {
  unregister.push(registerRoute(route));
}
function navigate(path: string) {
  act(() => {
    window.history.replaceState(null, "", `#${path}`);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
}
beforeEach(() => {
  document.title = "Observatory test app";
  navigate("/");
});
afterEach(() => {
  cleanup();
  unregister.splice(0).forEach((dispose) => {
    dispose();
  });
  vi.restoreAllMocks();
});

describe("shell registry integration", () => {
  it("renders honest no-route absence until a screen actually registers", async () => {
    render(<NatallyShell />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "No screen is registered for this route yet.",
    );
    expect(screen.getByLabelText(/^Version /)).toBeInTheDocument();
    act(() =>
      register({
        path: "/",
        load: async () => ({ default: () => <h1>Registered conversation</h1> }),
      }),
    );
    expect(
      await screen.findByRole("heading", { name: "Registered conversation" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("No screen is registered for this route yet."),
    ).not.toBeInTheDocument();
  });

  it("loads only the selected screen, passes route parameters and observes browser history", async () => {
    const people = vi.fn(async () => ({
      default: ({ params }: RouteScreenProps) => <h1>Person {params.id}</h1>,
    }));
    const settings = vi.fn(async () => ({ default: () => <h1>Settings screen</h1> }));
    register({ path: "/people/:id", load: people });
    register({ path: "/settings", load: settings });
    navigate("/people/42");
    render(<NatallyShell />);
    expect(await screen.findByRole("heading", { name: "Person 42" })).toBeInTheDocument();
    expect(settings).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "People" })).toHaveAttribute("aria-current", "page");
    act(() => {
      window.location.hash = "#/settings";
    });
    expect(await screen.findByRole("heading", { name: "Settings screen" })).toBeInTheDocument();
    act(() => {
      window.history.back();
    });
    expect(await screen.findByRole("heading", { name: "Person 42" })).toBeInTheDocument();
    expect(people).toHaveBeenCalledOnce();
    expect(settings).toHaveBeenCalledOnce();
    expect(screen.getByRole("main")).toHaveFocus();
  });

  it("keeps the version visible while a screen loads, fails, or does not exist", async () => {
    let reject: (reason: Error) => void = () => {
      throw new Error("Loader was not started");
    };
    register({
      path: "/",
      load: () =>
        new Promise((_resolve, rejectLoad) => {
          reject = rejectLoad;
        }),
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(<NatallyShell />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading screen…");
    expect(screen.getByLabelText(/^Version /)).toBeInTheDocument();
    await act(async () => {
      reject(new Error("Test load failure"));
    });
    expect(await screen.findByRole("alert")).toHaveTextContent("This screen is unavailable.");
    expect(screen.getByLabelText(/^Version /)).toBeInTheDocument();
    navigate("/missing");
    expect(screen.getByRole("status")).toHaveTextContent("This route does not exist.");
    expect(screen.getByLabelText(/^Version /)).toBeInTheDocument();
  });

  it("replaces a pending route without exposing its eventual stale content", async () => {
    let resolve: (value: Awaited<ReturnType<RouteRegistration["load"]>>) => void = () => {
      throw new Error("Loader was not started");
    };
    register({
      path: "/",
      load: () =>
        new Promise((resolveLoad) => {
          resolve = resolveLoad;
        }),
    });
    register({ path: "/about", load: async () => ({ default: () => <h1>About screen</h1> }) });
    render(<NatallyShell />);
    navigate("/about");
    expect(await screen.findByRole("heading", { name: "About screen" })).toBeInTheDocument();
    await act(async () => {
      resolve({ default: () => <h1>Stale screen</h1> });
    });
    expect(screen.queryByRole("heading", { name: "Stale screen" })).not.toBeInTheDocument();
  });

  it("preserves current screen state when an unrelated module registers", async () => {
    function StatefulScreen() {
      const [count, setCount] = useState(0);
      return (
        <button type="button" onClick={() => setCount((value) => value + 1)}>
          Count {count}
        </button>
      );
    }
    register({ path: "/", load: async () => ({ default: StatefulScreen }) });
    render(<NatallyShell />);
    fireEvent.click(await screen.findByRole("button", { name: "Count 0" }));
    act(() =>
      register({ path: "/about", load: async () => ({ default: () => <h1>About screen</h1> }) }),
    );
    expect(screen.getByRole("button", { name: "Count 1" })).toBeInTheDocument();
  });

  it("uses one menu, closes it on navigation and skips to content without corrupting the hash", async () => {
    render(<NatallyShell />);
    expect(screen.getAllByRole("navigation", { hidden: true })).toHaveLength(1);
    const menu = screen.getByRole("button", { name: "Menu" });
    fireEvent.click(menu);
    expect(menu).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("navigation")).toHaveAttribute("data-open", "true");
    navigate("/about");
    await waitFor(() => expect(menu).toHaveAttribute("aria-expanded", "false"));
    fireEvent.click(screen.getByRole("link", { name: "Skip to content" }));
    expect(window.location.hash).toBe("#/about");
    expect(screen.getByRole("main")).toHaveFocus();
  });
});
