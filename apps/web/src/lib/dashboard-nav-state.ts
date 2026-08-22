export function getDashboardNavExpandedStorageKey(slug: string): string {
  return `dashboard-nav-expanded:${slug}`
}

export function getDashboardNavExpandedCookieName(slug: string): string {
  return `arche-dashboard-nav-expanded-${slug}`
}
