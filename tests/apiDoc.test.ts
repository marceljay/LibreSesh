import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * `web/public/api.md` is the interface programs are told to write against, and
 * it is served from the instance itself — so a route added without a line in it
 * is a documented API that quietly stopped being the whole one. Vite copies
 * `web/public` verbatim into the build, which is what puts these two files at
 * `/api.md` and `/llms.txt`; nothing else serves them.
 *
 * This walks the routers rather than the doc, because the failure worth
 * catching is a new endpoint nobody wrote down.
 */
const ROUTES_DIR = join(import.meta.dirname, '..', 'server', 'src', 'routes');
const PUBLIC_DIR = join(import.meta.dirname, '..', 'web', 'public');

/** Paths left out of the reference on purpose. Empty, and worth keeping so. */
const UNDOCUMENTED = new Set<string>([]);

function routePaths(): string[] {
  const found = new Set<string>();
  for (const file of readdirSync(ROUTES_DIR)) {
    if (!file.endsWith('.ts')) continue;
    const src = readFileSync(join(ROUTES_DIR, file), 'utf8');
    for (const m of src.matchAll(/router\.(get|post|put|patch|delete)\(\s*(['"`])([^'"`]*)\2/g)) {
      found.add(m[3]);
    }
  }
  return [...found].sort();
}

describe('the served API reference', () => {
  const doc = readFileSync(join(PUBLIC_DIR, 'api.md'), 'utf8');

  it('names every route the server actually mounts', () => {
    const missing = routePaths().filter((p) => !UNDOCUMENTED.has(p) && !doc.includes(p));
    expect(missing).toEqual([]);
  });

  it('found the routers at all', () => {
    // Guards the test itself: a moved directory or a changed router idiom
    // would otherwise make the check above pass by finding nothing.
    expect(routePaths().length).toBeGreaterThan(60);
  });

  /**
   * Four documents, each with its own job, and the whole point of having four
   * is that a program landing on any one of them finds the others. A file that
   * stops linking on is a dead end for the agent that guessed that name.
   */
  it('cross-links the other three, from every one of them', () => {
    const paths = ['/llms.txt', '/agents.md', '/SKILL.md', '/api.md'];
    for (const name of ['llms.txt', 'agents.md', 'SKILL.md', 'api.md']) {
      const body = readFileSync(join(PUBLIC_DIR, name), 'utf8');
      const missing = paths.filter((p) => !p.endsWith(name) && !body.includes(p));
      expect({ [name]: missing }).toEqual({ [name]: [] });
    }
  });

  /**
   * `robots.txt` is the second thing an agent asked for in the 2026-09-15
   * walk-through, ahead of `/llms.txt` — so it is a discovery surface whether
   * or not it was meant to be one. A crawler parses only the directives; the
   * comments are for the program reading the file whole, and the cost of them
   * being wrong is an agent sent to a path that no longer exists.
   */
  it('points robots.txt at the four documents', () => {
    const robots = readFileSync(join(PUBLIC_DIR, 'robots.txt'), 'utf8');
    // The directive half has to be a directive half, or this is just a
    // comment file that happens to sit at a well-known name.
    expect(robots).toMatch(/^User-agent: /m);
    const missing = ['/llms.txt', '/agents.md', '/api.md', '/SKILL.md'].filter(
      (path) => !robots.includes(path),
    );
    expect(missing).toEqual([]);
  });

  it('gives SKILL.md the frontmatter that makes it a skill', () => {
    const skill = readFileSync(join(PUBLIC_DIR, 'SKILL.md'), 'utf8');
    // name + description in YAML frontmatter is what the format is; without
    // them a harness has nothing to match a task against.
    expect(skill.startsWith('---\n')).toBe(true);
    const frontmatter = skill.slice(4, skill.indexOf('\n---', 4));
    expect(frontmatter).toMatch(/^name: [\w-]+$/m);
    expect(frontmatter).toMatch(/^description: \S/m);
    // The format asks for under 500 lines, detail moved out to other files.
    expect(skill.split('\n').length).toBeLessThan(500);
  });
});
