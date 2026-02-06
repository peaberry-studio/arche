const BUCKET_LABELS = [
  "Today",
  "Yesterday",
  "This week",
  "Last week",
  "This month",
  "Older",
] as const;

export type BucketLabel = (typeof BUCKET_LABELS)[number];

export type BucketedGroup<T> = {
  label: BucketLabel;
  items: T[];
};

function getBucket(timestampMs: number, now: Date): BucketLabel {
  const d = new Date(timestampMs);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = today.getTime() - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const dayMs = 86_400_000;

  if (diff < dayMs) return "Today";
  if (diff < 2 * dayMs) return "Yesterday";

  // Same ISO week (Mon-Sun)
  const dayOfWeek = (today.getDay() + 6) % 7; // 0=Mon
  const weekStart = today.getTime() - dayOfWeek * dayMs;
  if (d.getTime() >= weekStart) return "This week";
  if (d.getTime() >= weekStart - 7 * dayMs) return "Last week";

  // Same month
  if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth())
    return "This month";

  return "Older";
}

/**
 * Group items into date buckets. Returns only non-empty buckets
 * with items sorted by timestamp descending within each bucket.
 */
export function groupByDateBucket<T>(
  items: T[],
  getTimestamp: (item: T) => number | undefined
): BucketedGroup<T>[] {
  const now = new Date();
  const bucketMap = new Map<BucketLabel, T[]>();

  for (const item of items) {
    const ts = getTimestamp(item);
    const label = ts ? getBucket(ts, now) : "Older";
    let arr = bucketMap.get(label);
    if (!arr) {
      arr = [];
      bucketMap.set(label, arr);
    }
    arr.push(item);
  }

  // Sort items within each bucket descending
  for (const arr of bucketMap.values()) {
    arr.sort((a, b) => (getTimestamp(b) ?? 0) - (getTimestamp(a) ?? 0));
  }

  // Return in canonical order, skip empty
  return BUCKET_LABELS.filter((label) => bucketMap.has(label)).map((label) => ({
    label,
    items: bucketMap.get(label)!,
  }));
}
