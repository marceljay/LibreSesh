import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The eye beside the event password at the gate.
 *
 * There is no DOM in this suite (`environment: node`), so what is pinned is
 * the wiring, as text: that the primitive flips the input's `type` and
 * nothing else, that the eye cannot submit the form it sits in, and that the
 * gate's password field goes through it rather than a bare `type="password"`.
 */
const WEB_SRC = join(import.meta.dirname, '..', 'web', 'src');
const read = (...parts: string[]) => readFileSync(join(WEB_SRC, ...parts), 'utf8');
const ui = read('components', 'ui.tsx');
const passwordInput = ui.slice(ui.indexOf('export const PasswordInput'), ui.indexOf('export function FormStack'));

describe('PasswordInput', () => {
  it('is a TextInput whose type the eye flips', () => {
    expect(passwordInput).toContain('const [shown, setShown] = useState(false);');
    expect(passwordInput).toContain(`<TextInput ref={ref} type={shown ? 'text' : 'password'} {...props} />`);
    // The caller cannot pass a `type` — the eye owns it.
    expect(passwordInput).toContain("Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'>");
  });

  it('has an eye that never submits the form, and keeps the caret in the box', () => {
    expect(passwordInput).toMatch(/<button\s+type="button"/);
    expect(passwordInput).toContain('onMouseDown={(e) => e.preventDefault()}');
    expect(passwordInput).toContain('onClick={() => setShown((s) => !s)}');
  });

  it('names its state for a screen reader, and draws it', () => {
    expect(passwordInput).toContain(`aria-label={shown ? 'Hide password' : 'Show password'}`);
    expect(passwordInput).toContain('aria-pressed={shown}');
    // Login convention: open eye on the masked box, struck eye on the shown one.
    expect(passwordInput).toContain('{shown ? <UnhideIcon /> : <HideIcon />}');
  });
});

describe('the gate uses it', () => {
  const gate = read('components', 'Gate.tsx');

  it('for the event password, with the manager-facing attributes intact', () => {
    expect(gate).toMatch(
      /<PasswordInput\s+name="password"\s+autoComplete="current-password"\s+enterKeyHint="go"/,
    );
    expect(gate).not.toContain('type="password"');
  });
});
