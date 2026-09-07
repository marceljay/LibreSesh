/**
 * Recognising the one error that means "this tab is running an old build".
 *
 * Pure, and here rather than beside the boundary that uses it, so the tests
 * can import it without pulling React in — the same reason `inviteLink`'s
 * parsing lives apart from the bit that touches `window.history`.
 */

/** Messages browsers use when a dynamic `import()` cannot be fetched or run.
 *  Chrome, Firefox and Safari each word it differently and none of them set a
 *  code or a named error type, so matching the text is what there is. */
const STALE_CHUNK = [
  'failed to fetch dynamically imported module',
  'error loading dynamically imported module',
  'importing a module script failed',
  'failed to load module script',
  // A 404 served as the site's index.html where JavaScript was expected: the
  // parser reaches `<!doctype` and reports a token, not a network failure.
  "unexpected token '<'",
];

export function isStaleChunkError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  const lower = message.toLowerCase();
  return STALE_CHUNK.some((fragment) => lower.includes(fragment));
}
