/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  WorkspaceThemeProvider,
  useWorkspaceTheme,
} from "@/contexts/workspace-theme-context";

const THEME_CLASSES = [
  "theme-warm-sand",
  "theme-ocean-mist",
  "theme-forest-dew",
  "theme-lavender-haze",
  "theme-sunset-glow",
  "theme-midnight-ember",
  "theme-midnight-ash",
  "theme-nuclear",
];

const DARK_CLASSES = ["dark", "dark-ember", "dark-ash", "dark-nuclear"];

function ThemeProbe() {
  const { themeId, setThemeId } = useWorkspaceTheme();

  return (
    <div>
      <span data-testid="theme-id">{themeId}</span>
      <button type="button" onClick={() => setThemeId("sunset-glow")}>set-sunset</button>
      <button type="button" onClick={() => setThemeId("warm-sand")}>set-warm</button>
    </div>
  );
}

describe("WorkspaceThemeProvider", () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    const root = document.documentElement;
    root.removeAttribute("data-arche-theme-owner");
    root.classList.remove(...THEME_CLASSES);
    root.classList.remove(...DARK_CLASSES);
  });

  it("loads and persists theme using workspace-scoped storage keys", () => {
    window.localStorage.setItem("arche.workspace.alpha.theme", "ocean-mist");
    window.localStorage.setItem("arche.workspace.beta.theme", "nuclear");

    render(
      <WorkspaceThemeProvider storageScope="alpha">
        <ThemeProbe />
      </WorkspaceThemeProvider>
    );

    expect(screen.getByTestId("theme-id").textContent).toBe("ocean-mist");

    fireEvent.click(screen.getByRole("button", { name: "set-sunset" }));

    expect(window.localStorage.getItem("arche.workspace.alpha.theme")).toBe("sunset-glow");
    expect(window.localStorage.getItem("arche.workspace.beta.theme")).toBe("nuclear");
  });

  it("migrates legacy theme key into the current workspace scope", () => {
    window.localStorage.setItem("arche.workspace.theme", "forest-dew");

    render(
      <WorkspaceThemeProvider storageScope="charlie">
        <ThemeProbe />
      </WorkspaceThemeProvider>
    );

    expect(screen.getByTestId("theme-id").textContent).toBe("forest-dew");
    expect(window.localStorage.getItem("arche.workspace.charlie.theme")).toBe("forest-dew");
  });

  it("applies theme classes to html and removes stale dark classes", async () => {
    window.localStorage.setItem("arche.workspace.alpha.theme", "nuclear");

    render(
      <WorkspaceThemeProvider storageScope="alpha">
        <ThemeProbe />
      </WorkspaceThemeProvider>
    );

    await waitFor(() => {
      const root = document.documentElement;
      expect(root.classList.contains("theme-nuclear")).toBe(true);
      expect(root.classList.contains("dark")).toBe(true);
      expect(root.classList.contains("dark-nuclear")).toBe(true);
    });

    fireEvent.click(screen.getByRole("button", { name: "set-warm" }));

    await waitFor(() => {
      const root = document.documentElement;
      expect(root.classList.contains("theme-warm-sand")).toBe(true);
      expect(root.classList.contains("dark")).toBe(false);
      expect(root.classList.contains("dark-nuclear")).toBe(false);
    });
  });

  it("updates the current scope when storage changes in another tab", async () => {
    render(
      <WorkspaceThemeProvider storageScope="alpha">
        <ThemeProbe />
      </WorkspaceThemeProvider>
    );

    expect(screen.getByTestId("theme-id").textContent).toBe("midnight-ash");

    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: "arche.workspace.alpha.theme",
          newValue: "ocean-mist",
          storageArea: window.localStorage,
        })
      );
    });

    await waitFor(() => {
      expect(screen.getByTestId("theme-id").textContent).toBe("ocean-mist");
    });
  });
});
