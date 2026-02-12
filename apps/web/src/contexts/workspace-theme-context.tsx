"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

export type WorkspaceThemeId =
  | "warm-sand"
  | "ocean-mist"
  | "forest-dew"
  | "lavender-haze"
  | "sunset-glow"
  | "midnight-ember"
  | "midnight-ash"
  | "nuclear";

export type DarkVariant = "ember" | "ash" | "nuclear";

export type WorkspaceTheme = {
  id: WorkspaceThemeId;
  name: string;
  gradient: string;
  /** Preview swatch colors for the picker UI */
  swatches: [string, string];
  /** Whether this theme uses dark mode colors */
  isDark: boolean;
  /** Dark mode color variant (only for dark themes) */
  darkVariant?: DarkVariant;
};

export const WORKSPACE_THEMES: Record<WorkspaceThemeId, WorkspaceTheme> = {
  "warm-sand": {
    id: "warm-sand",
    name: "Warm Sand",
    gradient: `
      radial-gradient(ellipse 80% 60% at 50% -10%, hsl(30 35% 94% / 0.9), transparent 60%),
      radial-gradient(ellipse 60% 50% at 100% 0%, hsl(24 45% 92% / 0.6), transparent 50%),
      linear-gradient(180deg, hsl(40 20% 97%), hsl(35 18% 95%))
    `,
    swatches: ["hsl(40 20% 97%)", "hsl(35 18% 92%)"],
    isDark: false,
  },
  "ocean-mist": {
    id: "ocean-mist",
    name: "Ocean Mist",
    gradient: `
      radial-gradient(ellipse 80% 60% at 50% -10%, hsl(200 40% 92% / 0.9), transparent 60%),
      radial-gradient(ellipse 60% 50% at 100% 0%, hsl(190 35% 90% / 0.6), transparent 50%),
      linear-gradient(180deg, hsl(200 25% 96%), hsl(195 20% 93%))
    `,
    swatches: ["hsl(200 25% 96%)", "hsl(195 30% 88%)"],
    isDark: false,
  },
  "forest-dew": {
    id: "forest-dew",
    name: "Forest Dew",
    gradient: `
      radial-gradient(ellipse 80% 60% at 50% -10%, hsl(140 30% 93% / 0.9), transparent 60%),
      radial-gradient(ellipse 60% 50% at 100% 0%, hsl(160 25% 90% / 0.6), transparent 50%),
      linear-gradient(180deg, hsl(140 18% 96%), hsl(150 15% 93%))
    `,
    swatches: ["hsl(140 18% 96%)", "hsl(150 25% 88%)"],
    isDark: false,
  },
  "lavender-haze": {
    id: "lavender-haze",
    name: "Lavender Haze",
    gradient: `
      radial-gradient(ellipse 80% 60% at 50% -10%, hsl(270 35% 94% / 0.9), transparent 60%),
      radial-gradient(ellipse 60% 50% at 100% 0%, hsl(280 30% 92% / 0.6), transparent 50%),
      linear-gradient(180deg, hsl(270 20% 97%), hsl(275 18% 94%))
    `,
    swatches: ["hsl(270 20% 97%)", "hsl(275 28% 90%)"],
    isDark: false,
  },
  "sunset-glow": {
    id: "sunset-glow",
    name: "Sunset Glow",
    gradient: `
      radial-gradient(ellipse 80% 60% at 50% -10%, hsl(20 50% 94% / 0.9), transparent 60%),
      radial-gradient(ellipse 60% 50% at 100% 0%, hsl(340 35% 93% / 0.6), transparent 50%),
      linear-gradient(180deg, hsl(25 30% 96%), hsl(15 25% 93%))
    `,
    swatches: ["hsl(25 30% 96%)", "hsl(340 30% 90%)"],
    isDark: false,
  },
  "midnight-ember": {
    id: "midnight-ember",
    name: "Midnight Ember",
    gradient: `linear-gradient(hsl(20 12% 9%), hsl(20 12% 9%))`,
    swatches: ["hsl(20 14% 14%)", "hsl(24 85% 55%)"],
    isDark: true,
    darkVariant: "ember",
  },
  "midnight-ash": {
    id: "midnight-ash",
    name: "Midnight Ash",
    gradient: `linear-gradient(hsl(0 0% 9%), hsl(0 0% 9%))`,
    swatches: ["hsl(0 0% 14%)", "hsl(24 85% 55%)"],
    isDark: true,
    darkVariant: "ash",
  },
  "nuclear": {
    id: "nuclear",
    name: "Nuclear",
    gradient: `linear-gradient(hsl(120 8% 6%), hsl(120 8% 6%))`,
    swatches: ["hsl(120 8% 10%)", "hsl(120 80% 50%)"],
    isDark: true,
    darkVariant: "nuclear",
  },
};

export const DEFAULT_THEME_ID: WorkspaceThemeId = "midnight-ash";

const STORAGE_KEY = "arche.workspace.theme";

type WorkspaceThemeContextValue = {
  theme: WorkspaceTheme;
  themeId: WorkspaceThemeId;
  setThemeId: (id: WorkspaceThemeId) => void;
  themes: WorkspaceTheme[];
};

const WorkspaceThemeContext = createContext<WorkspaceThemeContextValue | null>(
  null
);

export function WorkspaceThemeProvider({ children }: { children: ReactNode }) {
  const [themeId, setThemeIdState] = useState<WorkspaceThemeId>(() => {
    if (typeof window === "undefined") return DEFAULT_THEME_ID;
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored && stored in WORKSPACE_THEMES) {
      return stored as WorkspaceThemeId;
    }
    return DEFAULT_THEME_ID;
  });

  const setThemeId = useCallback((id: WorkspaceThemeId) => {
    setThemeIdState(id);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, id);
    }
  }, []);

  const theme = WORKSPACE_THEMES[themeId];
  const themes = Object.values(WORKSPACE_THEMES);

  return (
    <WorkspaceThemeContext.Provider
      value={{ theme, themeId, setThemeId, themes }}
    >
      {children}
    </WorkspaceThemeContext.Provider>
  );
}

export function useWorkspaceTheme() {
  const context = useContext(WorkspaceThemeContext);
  if (!context) {
    throw new Error(
      "useWorkspaceTheme must be used within a WorkspaceThemeProvider"
    );
  }
  return context;
}
