import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { readDevInfo } from '../web/devInfo';

/**
 * The dev bar names the checkout, branch and commit a dev server serves. The
 * values are read from git on request, so a commit made while the server runs
 * shows on the next load rather than after a restart.
 */
describe('what the dev bar is told', () => {
  const repo = join(import.meta.dirname, '..');
  const sh = (cmd: string, cwd = repo) =>
    execSync(cmd, { cwd, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();

  it('reads this checkout from git', () => {
    const info = readDevInfo(repo, '2026-09-14T10:00:00.000Z');
    expect(info.worktreePath).toBe(sh('git rev-parse --show-toplevel'));
    expect(info.worktree).toBe(basename(info.worktreePath!));
    expect(info.commit).toBe(sh('git rev-parse --short HEAD'));
    expect(info.branch).toBe(sh('git branch --show-current') || null);
    expect(info.mainWorktree).toBe(
      sh('git rev-parse --path-format=absolute --git-dir') ===
        sh('git rev-parse --path-format=absolute --git-common-dir'),
    );
    expect(info.startedAt).toBe('2026-09-14T10:00:00.000Z');
  });

  const empty = mkdtempSync(join(tmpdir(), 'libresesh-nogit-'));
  afterAll(() => rmSync(empty, { recursive: true, force: true }));

  it('is all nulls outside a checkout, not a crash', () => {
    const info = readDevInfo(empty, 'now');
    expect(info).toMatchObject({
      worktree: null,
      worktreePath: null,
      mainWorktree: false,
      branch: null,
      commit: null,
      dirty: false,
      startedAt: 'now',
    });
  });
});
