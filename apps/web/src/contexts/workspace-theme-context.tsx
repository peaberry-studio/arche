"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useState,
  type ReactNode,
} from "react";

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

const LEGACY_STORAGE_KEY = "arche.workspace.theme";
const STORAGE_KEY_PREFIX = "arche.workspace";
const ROOT_THEME_OWNER_ATTR = "data-arche-theme-owner";

const ALL_THEME_CLASSES = Object.keys(WORKSPACE_THEMES).map(
  (themeId) => `theme-${themeId}`
);

const ALL_DARK_VARIANT_CLASSES = Array.from(
  new Set(
    Object.values(WORKSPACE_THEMES)
      .map((theme) =>
        theme.isDark && theme.darkVariant ? `dark-${theme.darkVariant}` : null
      )
      .filter((className): className is string => className !== null)
  )
);

function getStorageKey(scope: string): string {
  return `${STORAGE_KEY_PREFIX}.${scope}.theme`;
}

function isWorkspaceThemeId(value: string): value is WorkspaceThemeId {
  return value in WORKSPACE_THEMES;
}

function loadThemeFromStorage(scope: string): WorkspaceThemeId | null {
  if (typeof window === "undefined") return null;

  try {
    const scopedStorageKey = getStorageKey(scope);
    const stored = window.localStorage.getItem(scopedStorageKey);
    if (stored && isWorkspaceThemeId(stored)) {
      return stored;
    }

    const legacy = window.localStorage.getItem(LEGACY_STORAGE_KEY);
    if (legacy && isWorkspaceThemeId(legacy)) {
      window.localStorage.setItem(scopedStorageKey, legacy);
      return legacy;
    }
  } catch {
    return null;
  }

  return null;
}

function applyThemeClasses(root: HTMLElement, theme: WorkspaceTheme) {
  root.classList.remove(...ALL_THEME_CLASSES);
  root.classList.remove("dark", ...ALL_DARK_VARIANT_CLASSES);
  root.classList.add(`theme-${theme.id}`);

  if (theme.isDark && theme.darkVariant) {
    root.classList.add("dark", `dark-${theme.darkVariant}`);
  }
}

type WorkspaceThemeContextValue = {
  theme: WorkspaceTheme;
  themeId: WorkspaceThemeId;
  setThemeId: (id: WorkspaceThemeId) => void;
  themes: WorkspaceTheme[];
};

const WorkspaceThemeContext = createContext<WorkspaceThemeContextValue | null>(
  null
);

type WorkspaceThemeProviderProps = {
  children: ReactNode;
  storageScope?: string;
};

export function WorkspaceThemeProvider({
  children,
  storageScope = "global",
}: WorkspaceThemeProviderProps) {
  const storageKey = useMemo(() => getStorageKey(storageScope), [storageScope]);
  const rootThemeOwnerId = useId();

  const [themeId, setThemeIdState] = useState<WorkspaceThemeId>(() => {
    const stored = loadThemeFromStorage(storageScope);
    return stored ?? DEFAULT_THEME_ID;
  });

  const setThemeId = useCallback(
    (id: WorkspaceThemeId) => {
      setThemeIdState(id);
      try {
        window.localStorage.setItem(storageKey, id);
      } catch {
        // Ignore storage access errors.
      }
    },
    [storageKey]
  );

  const theme = WORKSPACE_THEMES[themeId];
  const themes = useMemo(() => Object.values(WORKSPACE_THEMES), []);

  useEffect(() => {
    const root = document.documentElement;
    const ownerId = rootThemeOwnerId;
    root.setAttribute(ROOT_THEME_OWNER_ATTR, ownerId);
    applyThemeClasses(root, theme);

    return () => {
      if (root.getAttribute(ROOT_THEME_OWNER_ATTR) !== ownerId) return;
      root.classList.remove(...ALL_THEME_CLASSES);
      root.classList.remove("dark", ...ALL_DARK_VARIANT_CLASSES);
      root.removeAttribute(ROOT_THEME_OWNER_ATTR);
    };
  }, [rootThemeOwnerId, theme]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.storageArea !== window.localStorage) return;
      if (event.key !== storageKey) return;

      if (event.newValue && isWorkspaceThemeId(event.newValue)) {
        setThemeIdState(event.newValue);
        return;
      }

      setThemeIdState(DEFAULT_THEME_ID);
    };

    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("storage", onStorage);
    };
  }, [storageKey]);

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
