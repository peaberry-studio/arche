/** @vitest-environment jsdom */

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { hydrateRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { afterEach, describe, expect, it } from "vitest";

import {
  DEFAULT_CHAT_FONT_FAMILY,
  DEFAULT_CHAT_FONT_SIZE,
  DEFAULT_THEME_ID,
  useWorkspaceTheme,
  WorkspaceThemeProvider,
} from "@/contexts/workspace-theme-context";

function ThemeDisplay() {
  const { themeId } = useWorkspaceTheme();
  return <div data-testid="theme-id">{themeId}</div>;
}

function DarkModeDisplay() {
  const { isDark } = useWorkspaceTheme();
  return <div data-testid="is-dark">{String(isDark)}</div>;
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

function DarkToggle() {
  const { isDark, toggleDark } = useWorkspaceTheme();
  return (
    <>
      <div data-testid="is-dark">{String(isDark)}</div>
      <button onClick={toggleDark}>toggle dark</button>
    </>
  );
}

function ChatFontSizeDisplay() {
  const { chatFontSize } = useWorkspaceTheme();
  return <div data-testid="chat-font-size">{chatFontSize}</div>;
}

function ChatFontSizeSetter({ size }: { size: number }) {
  const { chatFontSize, setChatFontSize } = useWorkspaceTheme();
  return (
    <>
      <div data-testid="chat-font-size">{chatFontSize}</div>
      <button
        onClick={() => {
          if (size === 14 || size === 15 || size === 16 || size === 17 || size === 18) {
            setChatFontSize(size)
          }
        }}
      >
        set font size
      </button>
    </>
  );
}

function ChatFontFamilyDisplay() {
  const { chatFontFamily } = useWorkspaceTheme();
  return <div data-testid="chat-font-family">{chatFontFamily}</div>;
}

function ChatFontFamilySetter({ family }: { family: string }) {
  const { chatFontFamily, setChatFontFamily } = useWorkspaceTheme();
  return (
    <>
      <div data-testid="chat-font-family">{chatFontFamily}</div>
      <button
        onClick={() => {
          if (family === "sans" || family === "serif") {
            setChatFontFamily(family)
          }
        }}
      >
        set font family
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
    localStorage.setItem("arche.workspace.alice.theme", "ocean-mist");

    render(
      <WorkspaceThemeProvider storageScope="alice">
        <ThemeDisplay />
      </WorkspaceThemeProvider>
    );

    return waitFor(() => {
      expect(screen.getByTestId("theme-id").textContent).toBe("ocean-mist");
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

  it("uses default theme when no stored key exists", () => {
    render(
      <WorkspaceThemeProvider storageScope="new-user">
        <ThemeDisplay />
      </WorkspaceThemeProvider>
    );

    expect(screen.getByTestId("theme-id").textContent).toBe(DEFAULT_THEME_ID);
  });

  it("hydrates from the server theme and reconciles to localStorage without mismatch", async () => {
    localStorage.setItem("arche.workspace.alice.theme", "ocean-mist");

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
        expect(container.textContent).toContain('ocean-mist')
      })

      await waitFor(() => {
        expect(document.cookie).toContain('arche-workspace-theme-alice=ocean-mist')
      })

      expect(recoverableErrors).toEqual([])
    } finally {
      act(() => {
        root.unmount()
      })
      container.remove()
    }
  });

  it("applies correct html classes and removes dark class on theme change", () => {
    render(
      <WorkspaceThemeProvider storageScope="test" initialIsDark>
        <ThemeSetter id="ocean-mist" />
      </WorkspaceThemeProvider>
    );

    // Starts in dark mode with default theme
    const root = document.documentElement;
    expect(root.classList.contains(`theme-${DEFAULT_THEME_ID}`)).toBe(true);
    expect(root.classList.contains("dark")).toBe(true);

    act(() => {
      screen.getByRole("button", { name: "set" }).click();
    });

    // After switching to ocean-mist (still dark because we only changed color)
    expect(root.classList.contains("theme-ocean-mist")).toBe(true);
    expect(root.classList.contains(`theme-${DEFAULT_THEME_ID}`)).toBe(false);
    expect(root.classList.contains("dark")).toBe(true);
  });

  it("toggles dark mode independently of color", () => {
    render(
      <WorkspaceThemeProvider storageScope="test">
        <DarkToggle />
      </WorkspaceThemeProvider>
    );

    const root = document.documentElement;
    expect(root.classList.contains("dark")).toBe(false);
    expect(screen.getByTestId("is-dark").textContent).toBe("false");

    act(() => {
      screen.getByRole("button", { name: "toggle dark" }).click();
    });

    expect(root.classList.contains("dark")).toBe(true);
    expect(screen.getByTestId("is-dark").textContent).toBe("true");
    expect(localStorage.getItem("arche.workspace.test.dark-mode")).toBe("true");
    expect(document.cookie).toContain("arche-workspace-dark-mode-test=true");
  });

  it("accepts lavender-haze from scoped storage", () => {
    localStorage.setItem("arche.workspace.alice.theme", "lavender-haze");

    render(
      <WorkspaceThemeProvider storageScope="alice">
        <ThemeDisplay />
      </WorkspaceThemeProvider>
    );

    return waitFor(() => {
      expect(screen.getByTestId("theme-id").textContent).toBe("lavender-haze");
      expect(document.documentElement.classList.contains("theme-lavender-haze")).toBe(true);
    })
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

  it("syncs dark mode across tabs via storage event", () => {
    render(
      <WorkspaceThemeProvider storageScope="alice">
        <DarkModeDisplay />
      </WorkspaceThemeProvider>
    );

    expect(screen.getByTestId("is-dark").textContent).toBe("false");

    act(() => {
      localStorage.setItem("arche.workspace.alice.dark-mode", "true");
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: "arche.workspace.alice.dark-mode",
          newValue: "true",
        })
      );
    });

    expect(screen.getByTestId("is-dark").textContent).toBe("true");
  });

  it("loads chat font size from scoped storage key", () => {
    localStorage.setItem("arche.workspace.alice.chat-font-size", "17");

    render(
      <WorkspaceThemeProvider storageScope="alice">
        <ChatFontSizeDisplay />
      </WorkspaceThemeProvider>
    );

    return waitFor(() => {
      expect(screen.getByTestId("chat-font-size").textContent).toBe("17");
    })
  });

  it("saves chat font size to scoped storage key on setChatFontSize", () => {
    render(
      <WorkspaceThemeProvider storageScope="bob">
        <ChatFontSizeSetter size={18} />
      </WorkspaceThemeProvider>
    );

    act(() => {
      screen.getByRole("button", { name: "set font size" }).click();
    });

    expect(localStorage.getItem("arche.workspace.bob.chat-font-size")).toBe("18");
    expect(localStorage.getItem("arche.workspace.alice.chat-font-size")).toBeNull();
    expect(document.cookie).toContain("arche-workspace-chat-font-size-bob=18");
  });

  it("syncs chat font size across tabs via storage event", () => {
    render(
      <WorkspaceThemeProvider storageScope="alice">
        <ChatFontSizeDisplay />
      </WorkspaceThemeProvider>
    );

    expect(screen.getByTestId("chat-font-size").textContent).toBe(String(DEFAULT_CHAT_FONT_SIZE));

    act(() => {
      localStorage.setItem("arche.workspace.alice.chat-font-size", "16");
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: "arche.workspace.alice.chat-font-size",
          newValue: "16",
        })
      );
    });

    expect(screen.getByTestId("chat-font-size").textContent).toBe("16");
  });

  it("loads chat font family from scoped storage key", () => {
    localStorage.setItem("arche.workspace.alice.chat-font-family", "serif");

    render(
      <WorkspaceThemeProvider storageScope="alice">
        <ChatFontFamilyDisplay />
      </WorkspaceThemeProvider>
    );

    return waitFor(() => {
      expect(screen.getByTestId("chat-font-family").textContent).toBe("serif");
    })
  });

  it("saves chat font family to scoped storage key on setChatFontFamily", () => {
    render(
      <WorkspaceThemeProvider storageScope="bob">
        <ChatFontFamilySetter family="serif" />
      </WorkspaceThemeProvider>
    );

    act(() => {
      screen.getByRole("button", { name: "set font family" }).click();
    });

    expect(localStorage.getItem("arche.workspace.bob.chat-font-family")).toBe("serif");
    expect(localStorage.getItem("arche.workspace.alice.chat-font-family")).toBeNull();
    expect(document.cookie).toContain("arche-workspace-chat-font-family-bob=serif");
  });

  it("syncs chat font family across tabs via storage event", () => {
    render(
      <WorkspaceThemeProvider storageScope="alice">
        <ChatFontFamilyDisplay />
      </WorkspaceThemeProvider>
    );

    expect(screen.getByTestId("chat-font-family").textContent).toBe(DEFAULT_CHAT_FONT_FAMILY);

    act(() => {
      localStorage.setItem("arche.workspace.alice.chat-font-family", "serif");
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: "arche.workspace.alice.chat-font-family",
          newValue: "serif",
        })
      );
    });

    expect(screen.getByTestId("chat-font-family").textContent).toBe("serif");
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
    expect(root.classList.contains(`theme-${DEFAULT_THEME_ID}`)).toBe(true);

    unmount();

    expect(root.classList.contains(`theme-${DEFAULT_THEME_ID}`)).toBe(false);
    expect(root.hasAttribute("data-arche-theme-owner")).toBe(false);
  });

});
