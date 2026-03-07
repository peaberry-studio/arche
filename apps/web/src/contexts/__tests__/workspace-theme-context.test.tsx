/** @vitest-environment jsdom */

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { hydrateRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { afterEach, describe, expect, it } from "vitest";

import {
  DEFAULT_THEME_ID,
  useWorkspaceTheme,
  WorkspaceThemeProvider,
} from "@/contexts/workspace-theme-context";

function ThemeDisplay() {
  const { themeId } = useWorkspaceTheme();
  return <div data-testid="theme-id">{themeId}</div>;
}

function ThemeSetter({ id }: { id: string }) {
  const { setThemeId, themeId } = useWorkspaceTheme();
  return (
    <>
      <div data-testid="theme-id">{themeId}</div>
      <button
        onClick={() => setThemeId(id as Parameters<typeof setThemeId>[0])}
      >
        set
      </button>
    </>
  );
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  document.cookie.split(';').forEach((cookie) => {
    const [name] = cookie.trim().split('=');
    if (!name) return;
    document.cookie = `${name}=; Path=/; Max-Age=0`;
  });
  const root = document.documentElement;
  root.className = "";
  root.removeAttribute("data-arche-theme-owner");
});

describe("WorkspaceThemeProvider", () => {
  it("loads theme from scoped storage key", () => {
    localStorage.setItem("arche.workspace.alice.theme", "warm-sand");

    render(
      <WorkspaceThemeProvider storageScope="alice">
        <ThemeDisplay />
      </WorkspaceThemeProvider>
    );

    return waitFor(() => {
      expect(screen.getByTestId("theme-id").textContent).toBe("warm-sand");
    })
  });

  it("saves to scoped storage key on setThemeId", () => {
    render(
      <WorkspaceThemeProvider storageScope="bob">
        <ThemeSetter id="ocean-mist" />
      </WorkspaceThemeProvider>
    );

    act(() => {
      screen.getByRole("button", { name: "set" }).click();
    });

    expect(localStorage.getItem("arche.workspace.bob.theme")).toBe("ocean-mist");
    expect(localStorage.getItem("arche.workspace.alice.theme")).toBeNull();
    expect(document.cookie).toContain("arche-workspace-theme-bob=ocean-mist");
  });

  it("uses default theme when no stored key exists (no legacy fallback)", () => {
    localStorage.setItem("arche.workspace.theme", "warm-sand"); // old global key

    render(
      <WorkspaceThemeProvider storageScope="new-user">
        <ThemeDisplay />
      </WorkspaceThemeProvider>
    );

    expect(screen.getByTestId("theme-id").textContent).toBe(DEFAULT_THEME_ID);
  });

  it("hydrates from the server theme and reconciles to localStorage without mismatch", async () => {
    localStorage.setItem("arche.workspace.alice.theme", "warm-sand");

    const recoverableErrors: string[] = []
    const container = document.createElement('div')
    document.body.appendChild(container)
    container.innerHTML = renderToString(
      <WorkspaceThemeProvider storageScope="alice" initialThemeId="forest-dew">
        <ThemeDisplay />
      </WorkspaceThemeProvider>
    )

    expect(container.textContent).toContain('forest-dew')

    const root = hydrateRoot(
      container,
      <WorkspaceThemeProvider storageScope="alice" initialThemeId="forest-dew">
        <ThemeDisplay />
      </WorkspaceThemeProvider>,
      {
        onRecoverableError: (error) => {
          recoverableErrors.push(error.message)
        },
      }
    )

    try {
      await waitFor(() => {
        expect(container.textContent).toContain('warm-sand')
      })

      await waitFor(() => {
        expect(document.cookie).toContain('arche-workspace-theme-alice=warm-sand')
      })

      expect(recoverableErrors).toEqual([])
    } finally {
      act(() => {
        root.unmount()
      })
      container.remove()
    }
  });

  it("applies correct html classes and removes stale dark classes on theme change", () => {
    render(
      <WorkspaceThemeProvider storageScope="test">
        <ThemeSetter id="warm-sand" />
      </WorkspaceThemeProvider>
    );

    // Default theme is midnight-ash (dark)
    const root = document.documentElement;
    expect(root.classList.contains("theme-midnight-ash")).toBe(true);
    expect(root.classList.contains("dark")).toBe(true);
    expect(root.classList.contains("dark-ash")).toBe(true);

    act(() => {
      screen.getByRole("button", { name: "set" }).click();
    });

    // After switching to warm-sand (light theme)
    expect(root.classList.contains("theme-warm-sand")).toBe(true);
    expect(root.classList.contains("theme-midnight-ash")).toBe(false);
    expect(root.classList.contains("dark")).toBe(false);
    expect(root.classList.contains("dark-ash")).toBe(false);
  });

  it("syncs theme across tabs via storage event", () => {
    render(
      <WorkspaceThemeProvider storageScope="alice">
        <ThemeDisplay />
      </WorkspaceThemeProvider>
    );

    expect(screen.getByTestId("theme-id").textContent).toBe(DEFAULT_THEME_ID);

    act(() => {
      localStorage.setItem("arche.workspace.alice.theme", "forest-dew");
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: "arche.workspace.alice.theme",
          newValue: "forest-dew",
        })
      );
    });

    expect(screen.getByTestId("theme-id").textContent).toBe("forest-dew");
  });

  it("ignores storage events for other scopes", () => {
    render(
      <WorkspaceThemeProvider storageScope="alice">
        <ThemeDisplay />
      </WorkspaceThemeProvider>
    );

    act(() => {
      localStorage.setItem("arche.workspace.bob.theme", "forest-dew");
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: "arche.workspace.bob.theme",
          newValue: "forest-dew",
        })
      );
    });

    expect(screen.getByTestId("theme-id").textContent).toBe(DEFAULT_THEME_ID);
  });

  it("removes html classes on unmount when owner matches", () => {
    const { unmount } = render(
      <WorkspaceThemeProvider storageScope="test">
        <ThemeDisplay />
      </WorkspaceThemeProvider>
    );

    const root = document.documentElement;
    expect(root.classList.contains("theme-midnight-ash")).toBe(true);

    unmount();

    expect(root.classList.contains("theme-midnight-ash")).toBe(false);
    expect(root.hasAttribute("data-arche-theme-owner")).toBe(false);
  });
});
