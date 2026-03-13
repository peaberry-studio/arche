"use client";

import { createContext, useCallback, useContext, useEffect, useId, useMemo, useState, type ReactNode } from "react";

import {
  DEFAULT_CHAT_FONT_FAMILY,
  DEFAULT_CHAT_FONT_SIZE,
  DEFAULT_DARK_MODE,
  DEFAULT_THEME_ID,
  getWorkspaceChatFontFamilyCookieName,
  getWorkspaceChatFontFamilyStorageKey,
  getWorkspaceChatFontSizeCookieName,
  getWorkspaceChatFontSizeStorageKey,
  getWorkspaceDarkModeCookieName,
  getWorkspaceDarkModeStorageKey,
  getWorkspaceThemeCookieName,
  getWorkspaceThemeStorageKey,
  isWorkspaceChatFontFamily,
  isWorkspaceChatFontSize,
  isWorkspaceThemeId,
  WORKSPACE_CHAT_FONT_SIZES,
  type WorkspaceChatFontFamily,
  type WorkspaceChatFontSize,
  type WorkspaceThemeId,
} from '@/lib/workspace-theme'

export { DEFAULT_CHAT_FONT_FAMILY, DEFAULT_CHAT_FONT_SIZE, DEFAULT_DARK_MODE, DEFAULT_THEME_ID } from '@/lib/workspace-theme'

export type WorkspaceTheme = {
  id: WorkspaceThemeId;
  name: string;
  /** Primary color swatch for the picker UI */
  swatch: string;
};

export const WORKSPACE_THEMES: Record<WorkspaceThemeId, WorkspaceTheme> = {
  "warm-sand": {
    id: "warm-sand",
    name: "Sand",
    swatch: "hsl(24 90% 55%)",
  },
  "ocean-mist": {
    id: "ocean-mist",
    name: "Ocean",
    swatch: "hsl(195 22% 50%)",
  },
  "forest-dew": {
    id: "forest-dew",
    name: "Forest",
    swatch: "hsl(152 20% 46%)",
  },
  "lavender-haze": {
    id: "lavender-haze",
    name: "Lavender",
    swatch: "hsl(272 20% 58%)",
  },
  "sunset-glow": {
    id: "sunset-glow",
    name: "Sunset",
    swatch: "hsl(348 26% 56%)",
  },
};

const ROOT_THEME_OWNER_ATTR = "data-arche-theme-owner";
const ALL_THEME_CLASSES = Object.keys(WORKSPACE_THEMES).map((id) => `theme-${id}`);
const MIN_CHAT_FONT_SIZE = WORKSPACE_CHAT_FONT_SIZES[0]
const MAX_CHAT_FONT_SIZE = WORKSPACE_CHAT_FONT_SIZES[WORKSPACE_CHAT_FONT_SIZES.length - 1]

function readStoredThemeId(storageKey: string): WorkspaceThemeId | null {
  try {
    const stored = window.localStorage.getItem(storageKey)
    return stored && isWorkspaceThemeId(stored) ? stored : null
  } catch {
    return null
  }
}

function readStoredDarkMode(storageKey: string): boolean | null {
  try {
    const stored = window.localStorage.getItem(storageKey)
    if (stored === 'true') return true
    if (stored === 'false') return false
    return null
  } catch {
    return null
  }
}

function readStoredChatFontSize(storageKey: string): WorkspaceChatFontSize | null {
  try {
    const stored = window.localStorage.getItem(storageKey)
    const parsed = stored ? Number.parseInt(stored, 10) : Number.NaN
    return isWorkspaceChatFontSize(parsed) ? parsed : null
  } catch {
    return null
  }
}

function readStoredChatFontFamily(storageKey: string): WorkspaceChatFontFamily | null {
  try {
    const stored = window.localStorage.getItem(storageKey)
    return stored && isWorkspaceChatFontFamily(stored) ? stored : null
  } catch {
    return null
  }
}

function persistThemeCookie(scope: string, themeId: WorkspaceThemeId) {
  if (typeof document === 'undefined') return;

  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${getWorkspaceThemeCookieName(scope)}=${themeId}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
}

function persistDarkModeCookie(scope: string, isDark: boolean) {
  if (typeof document === 'undefined') return;

  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${getWorkspaceDarkModeCookieName(scope)}=${isDark ? 'true' : 'false'}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
}

function persistChatFontSizeCookie(scope: string, chatFontSize: WorkspaceChatFontSize) {
  if (typeof document === 'undefined') return

  const secure = window.location.protocol === 'https:' ? '; Secure' : ''
  document.cookie = `${getWorkspaceChatFontSizeCookieName(scope)}=${chatFontSize}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`
}

function persistChatFontFamilyCookie(scope: string, chatFontFamily: WorkspaceChatFontFamily) {
  if (typeof document === 'undefined') return

  const secure = window.location.protocol === 'https:' ? '; Secure' : ''
  document.cookie = `${getWorkspaceChatFontFamilyCookieName(scope)}=${chatFontFamily}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`
}

function applyThemeClasses(root: HTMLElement, themeId: WorkspaceThemeId, isDark: boolean) {
  root.classList.remove(...ALL_THEME_CLASSES, "dark");
  root.classList.add(`theme-${themeId}`);
  if (isDark) {
    root.classList.add("dark");
  }
}

type WorkspaceThemeContextValue = {
  theme: WorkspaceTheme;
  themeId: WorkspaceThemeId;
  isDark: boolean;
  setDark: (dark: boolean) => void;
  toggleDark: () => void;
  chatFontFamily: WorkspaceChatFontFamily;
  chatFontSize: WorkspaceChatFontSize;
  setChatFontFamily: (family: WorkspaceChatFontFamily) => void;
  canDecreaseChatFontSize: boolean;
  canIncreaseChatFontSize: boolean;
  decreaseChatFontSize: () => void;
  increaseChatFontSize: () => void;
  setChatFontSize: (size: WorkspaceChatFontSize) => void;
  setThemeId: (id: WorkspaceThemeId) => void;
  themes: WorkspaceTheme[];
};

const WorkspaceThemeContext = createContext<WorkspaceThemeContextValue | null>(
  null
);

export function WorkspaceThemeProvider({
  children,
  storageScope = "global",
  initialChatFontFamily = DEFAULT_CHAT_FONT_FAMILY,
  initialChatFontSize = DEFAULT_CHAT_FONT_SIZE,
  initialIsDark = DEFAULT_DARK_MODE,
  initialThemeId = DEFAULT_THEME_ID,
}: {
  children: ReactNode;
  storageScope?: string;
  initialChatFontFamily?: WorkspaceChatFontFamily;
  initialChatFontSize?: WorkspaceChatFontSize;
  initialIsDark?: boolean;
  initialThemeId?: WorkspaceThemeId;
}) {
  const chatFontFamilyStorageKey = useMemo(() => getWorkspaceChatFontFamilyStorageKey(storageScope), [storageScope]);
  const chatFontSizeStorageKey = useMemo(() => getWorkspaceChatFontSizeStorageKey(storageScope), [storageScope]);
  const darkModeStorageKey = useMemo(() => getWorkspaceDarkModeStorageKey(storageScope), [storageScope]);
  const storageKey = useMemo(() => getWorkspaceThemeStorageKey(storageScope), [storageScope]);
  const rootThemeOwnerId = useId();

  const [chatFontFamily, setChatFontFamilyState] = useState<WorkspaceChatFontFamily>(initialChatFontFamily)
  const [chatFontSize, setChatFontSizeState] = useState<WorkspaceChatFontSize>(initialChatFontSize)
  const [isDark, setDarkState] = useState(initialIsDark)
  const [themeId, setThemeIdState] = useState<WorkspaceThemeId>(initialThemeId)

  const setThemeId = useCallback(
    (id: WorkspaceThemeId) => {
      setThemeIdState(id)
      if (typeof window !== "undefined") {
        try {
          window.localStorage.setItem(storageKey, id);
        } catch {
          // ignore storage errors
        }
        persistThemeCookie(storageScope, id)
      }
    },
    [storageKey, storageScope]
  );

  const setDark = useCallback(
    (dark: boolean) => {
      setDarkState(dark)
      if (typeof window !== "undefined") {
        try {
          window.localStorage.setItem(darkModeStorageKey, String(dark));
        } catch {
          // ignore storage errors
        }
        persistDarkModeCookie(storageScope, dark)
      }
    },
    [darkModeStorageKey, storageScope]
  );

  const toggleDark = useCallback(() => {
    setDark(!isDark)
  }, [isDark, setDark])

  const setChatFontSize = useCallback(
    (size: WorkspaceChatFontSize) => {
      setChatFontSizeState(size)
      if (typeof window !== 'undefined') {
        try {
          window.localStorage.setItem(chatFontSizeStorageKey, String(size))
        } catch {
          // ignore storage errors
        }
        persistChatFontSizeCookie(storageScope, size)
      }
    },
    [chatFontSizeStorageKey, storageScope]
  )

  const setChatFontFamily = useCallback(
    (family: WorkspaceChatFontFamily) => {
      setChatFontFamilyState(family)
      if (typeof window !== 'undefined') {
        try {
          window.localStorage.setItem(chatFontFamilyStorageKey, family)
        } catch {
          // ignore storage errors
        }
        persistChatFontFamilyCookie(storageScope, family)
      }
    },
    [chatFontFamilyStorageKey, storageScope]
  )

  const canDecreaseChatFontSize = chatFontSize > MIN_CHAT_FONT_SIZE
  const canIncreaseChatFontSize = chatFontSize < MAX_CHAT_FONT_SIZE

  const decreaseChatFontSize = useCallback(() => {
    const nextChatFontSize = Math.max(MIN_CHAT_FONT_SIZE, chatFontSize - 1)
    if (isWorkspaceChatFontSize(nextChatFontSize)) {
      setChatFontSize(nextChatFontSize)
    }
  }, [chatFontSize, setChatFontSize])

  const increaseChatFontSize = useCallback(() => {
    const nextChatFontSize = Math.min(MAX_CHAT_FONT_SIZE, chatFontSize + 1)
    if (isWorkspaceChatFontSize(nextChatFontSize)) {
      setChatFontSize(nextChatFontSize)
    }
  }, [chatFontSize, setChatFontSize])

  const theme = WORKSPACE_THEMES[themeId];
  const themes = useMemo(() => Object.values(WORKSPACE_THEMES), []);

  // Reconcile localStorage → state on mount (chat font family)
  useEffect(() => {
    const storedChatFontFamily = readStoredChatFontFamily(chatFontFamilyStorageKey)
    if (!storedChatFontFamily || storedChatFontFamily === chatFontFamily) return

    queueMicrotask(() => {
      setChatFontFamilyState((current) => current === storedChatFontFamily ? current : storedChatFontFamily)
    })
  }, [chatFontFamilyStorageKey, chatFontFamily])

  // Reconcile localStorage → state on mount (chat font size)
  useEffect(() => {
    const storedChatFontSize = readStoredChatFontSize(chatFontSizeStorageKey)
    if (!storedChatFontSize || storedChatFontSize === chatFontSize) return

    queueMicrotask(() => {
      setChatFontSizeState((current) => current === storedChatFontSize ? current : storedChatFontSize)
    })
  }, [chatFontSizeStorageKey, chatFontSize])

  // Reconcile localStorage → state on mount (theme ID)
  useEffect(() => {
    const storedThemeId = readStoredThemeId(storageKey)
    if (!storedThemeId || storedThemeId === themeId) return

    queueMicrotask(() => {
      setThemeIdState((current) => current === storedThemeId ? current : storedThemeId)
    })
  }, [storageKey, themeId])

  // Reconcile localStorage → state on mount (dark mode)
  useEffect(() => {
    const storedDarkMode = readStoredDarkMode(darkModeStorageKey)
    if (storedDarkMode === null || storedDarkMode === isDark) return

    queueMicrotask(() => {
      setDarkState((current) => current === storedDarkMode ? current : storedDarkMode)
    })
  }, [darkModeStorageKey, isDark])

  // Persist chat font family
  useEffect(() => {
    try {
      window.localStorage.setItem(chatFontFamilyStorageKey, chatFontFamily)
    } catch {
      // ignore storage errors
    }

    persistChatFontFamilyCookie(storageScope, chatFontFamily)
  }, [chatFontFamily, chatFontFamilyStorageKey, storageScope])

  // Persist chat font size
  useEffect(() => {
    try {
      window.localStorage.setItem(chatFontSizeStorageKey, String(chatFontSize))
    } catch {
      // ignore storage errors
    }

    persistChatFontSizeCookie(storageScope, chatFontSize)
  }, [chatFontSize, chatFontSizeStorageKey, storageScope])

  // Persist theme ID
  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey, themeId)
    } catch {
      // ignore storage errors
    }

    persistThemeCookie(storageScope, themeId)
  }, [storageKey, storageScope, themeId])

  // Persist dark mode
  useEffect(() => {
    try {
      window.localStorage.setItem(darkModeStorageKey, String(isDark))
    } catch {
      // ignore storage errors
    }

    persistDarkModeCookie(storageScope, isDark)
  }, [darkModeStorageKey, isDark, storageScope])

  // Cross-tab sync via storage events
  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key === storageKey) {
        const nextThemeId = event.newValue && isWorkspaceThemeId(event.newValue)
          ? event.newValue
          : null

        if (!nextThemeId) return

        setThemeIdState(nextThemeId)
        persistThemeCookie(storageScope, nextThemeId)
        return
      }

      if (event.key === darkModeStorageKey) {
        if (event.newValue === 'true') {
          setDarkState(true)
          persistDarkModeCookie(storageScope, true)
        } else if (event.newValue === 'false') {
          setDarkState(false)
          persistDarkModeCookie(storageScope, false)
        }
        return
      }

      if (event.key === chatFontFamilyStorageKey) {
        const nextChatFontFamily = event.newValue && isWorkspaceChatFontFamily(event.newValue)
          ? event.newValue
          : null

        if (!nextChatFontFamily) return

        setChatFontFamilyState(nextChatFontFamily)
        persistChatFontFamilyCookie(storageScope, nextChatFontFamily)
        return
      }

      if (event.key !== chatFontSizeStorageKey) return

      const nextChatFontSize = event.newValue ? Number.parseInt(event.newValue, 10) : Number.NaN
      if (!isWorkspaceChatFontSize(nextChatFontSize)) return

      setChatFontSizeState(nextChatFontSize)
      persistChatFontSizeCookie(storageScope, nextChatFontSize)
    }

    window.addEventListener('storage', handleStorage)
    return () => window.removeEventListener('storage', handleStorage)
  }, [chatFontFamilyStorageKey, chatFontSizeStorageKey, darkModeStorageKey, storageKey, storageScope])

  // Apply theme classes to <html>
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute(ROOT_THEME_OWNER_ATTR, rootThemeOwnerId);
    applyThemeClasses(root, themeId, isDark);
    return () => {
      if (root.getAttribute(ROOT_THEME_OWNER_ATTR) !== rootThemeOwnerId) return;
      root.classList.remove(...ALL_THEME_CLASSES, "dark");
      root.removeAttribute(ROOT_THEME_OWNER_ATTR);
    };
  }, [isDark, rootThemeOwnerId, themeId]);

  // Global keyboard shortcut: Cmd/Ctrl+U toggles dark mode
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'u') {
        event.preventDefault();
        toggleDark();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggleDark]);

  return (
    <WorkspaceThemeContext.Provider
      value={{
        canDecreaseChatFontSize,
        canIncreaseChatFontSize,
        chatFontFamily,
        chatFontSize,
        decreaseChatFontSize,
        increaseChatFontSize,
        isDark,
        setChatFontFamily,
        setChatFontSize,
        setDark,
        setThemeId,
        theme,
        themeId,
        themes,
        toggleDark,
      }}
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
