"use client";

import { useSyncExternalStore } from "react";

export const SSR_VIEWPORT_WIDTH = 1280;

function subscribeViewportWidth(onStoreChange: () => void) {
  window.addEventListener("resize", onStoreChange);
  return () => window.removeEventListener("resize", onStoreChange);
}

function getViewportWidth() {
  return window.innerWidth;
}

function getServerViewportWidth() {
  return SSR_VIEWPORT_WIDTH;
}

export function useViewportWidth() {
  return useSyncExternalStore(
    subscribeViewportWidth,
    getViewportWidth,
    getServerViewportWidth,
  );
}
