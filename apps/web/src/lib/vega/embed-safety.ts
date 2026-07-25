import { isSafeHref } from '@/lib/vega/sanitize-spec'

const XLINK_NAMESPACE = 'http://www.w3.org/1999/xlink'
const MAX_ERROR_DETAIL_CHARS = 300

// vega-tooltip's built-in escaper only replaces `&` and `<`. That is enough for the text
// cells it builds today, but it leaves no margin if a value reaches an attribute context.
// Escaping the full set keeps data strictly data regardless of the tooltip template.
const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

export function escapeTooltipValue(value: unknown): string {
  return String(value).replace(/[&<>"']/g, (char) => HTML_ESCAPES[char] ?? char)
}

/**
 * True when a click on this element should be cancelled. The `href` encoding channel can
 * be driven by a Vega expression, so its value only exists once the view has rendered —
 * this is the authoritative check, and it covers anchors recreated by a re-render after a
 * selection changes.
 */
export function isUnsafeChartLinkTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false

  const anchor = target.closest('a')
  if (!anchor) return false

  const href = anchor.getAttribute('href') ?? anchor.getAttributeNS(XLINK_NAMESPACE, 'href')
  return href !== null && !isSafeHref(href)
}

/**
 * Bounds the asynchronous part of embedding — chiefly workspace data loading. It cannot
 * interrupt Vega's synchronous compile, dataflow and layout: the timer will not fire while
 * those block the event loop, and a Worker is not an option in the browser because
 * tooltips, selections and hover all need the main-thread DOM. The row and sequence budgets
 * in the sanitizer are the pre-emptive defence for that; PDF export, which needs no
 * interactivity, renders in a worker thread that can genuinely be terminated.
 */
export function withRenderTimeout<T extends { finalize: () => void }>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Chart rendering exceeded ${Math.round(timeoutMs / 1000)}s and was cancelled.`))
      // Tear the view down if it does eventually finish.
      promise.then((result) => result.finalize()).catch(() => {})
    }, timeoutMs)

    promise.then(
      (result) => {
        clearTimeout(timer)
        resolve(result)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error instanceof Error ? error : new Error(String(error)))
      },
    )
  })
}

/** Vega-Lite's own compile errors are the most useful thing to show; keep them short. */
export function describeRenderError(error: unknown): string | null {
  const message = error instanceof Error ? error.message.trim() : ''
  if (!message) return null
  return message.length > MAX_ERROR_DETAIL_CHARS
    ? `${message.slice(0, MAX_ERROR_DETAIL_CHARS)}…`
    : message
}
