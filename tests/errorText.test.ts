import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * i18n readiness rule 2 (forms strategy): the server reports *what happened* as
 * a machine code plus structured details, and the client decides how to say it.
 * Rendering `err.message` would put English in the API — the one thing that
 * cannot be translated later without touching every route.
 *
 * There is no DOM here, so what is pinned is the contract: every code the server
 * can throw has a sentence on the client, and no screen renders the server's own
 * string.
 */
const ROOT = join(import.meta.dirname, '..');
const WEB_SRC = join(ROOT, 'web', 'src');
const errorText = readFileSync(join(WEB_SRC, 'lib', 'errorText.ts'), 'utf8');

function tsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return tsFiles(path);
    return /\.tsx?$/.test(e.name) ? [path] : [];
  });
}

/** Codes passed explicitly to the error helpers, which is every code a client
 *  can branch on. The defaults (`validation`, `not_found`, …) fall through to
 *  the status fallback by design. */
function serverCodes(): string[] {
  const codes = new Set<string>();
  for (const file of tsFiles(join(ROOT, 'server', 'src'))) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(
      /\b(?:badRequest|conflict)\(\s*(?:`[^`]*`|'[^']*'|"[^"]*"|[^,()]+)\s*,\s*'([a-z_]+)'/g,
    )) {
      codes.add(m[1] as string);
    }
  }
  return [...codes].sort();
}

describe('a failure becomes a sentence on the client', () => {
  it('has a sentence for every code the server throws', () => {
    // A new code with no sentence here is the regression: it would silently
    // degrade to the generic status line instead of saying what went wrong.
    const missing = serverCodes().filter((code) => !errorText.includes(`case '${code}':`));
    expect(missing).toEqual([]);
  });

  it('never renders what the server wrote', () => {
    const offenders = tsFiles(WEB_SRC)
      .filter((path) => !path.endsWith(join('lib', 'errorText.ts')))
      // importDoc parses a document in the browser; that Error is ours, not the
      // API's, and its message is the parser's own explanation.
      .filter((path) => !path.endsWith(join('lib', 'importDoc.ts')))
      .filter((path) => /\b(?:err|error)\.message\b/.test(readFileSync(path, 'utf8')))
      .map((path) => path.slice(WEB_SRC.length + 1));
    expect(offenders).toEqual([]);
  });

  it('keeps the moving parts as data, not baked-in English', () => {
    // The two messages with a variable in them: the server sends the value in
    // `details` and the client builds the sentence.
    const rules = readFileSync(join(ROOT, 'server', 'src', 'sessionRules.ts'), 'utf8');
    const identity = readFileSync(join(ROOT, 'server', 'src', 'eventIdentity.ts'), 'utf8');
    expect(rules).toContain('{ title: blocker.title }');
    expect(identity).toContain('name: desired');
    expect(errorText).toContain('quoted(d.title)');
    expect(errorText).toContain('quoted(d.name)');
  });
});
