import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { GeneratedPasswords, ImportResult } from '@shared/types';
import { api, ApiError } from '../lib/api';
import { parseDoc, type DocSummary } from '../lib/importDoc';
import {
  ControlShell,
  Field,
  FormError,
  PrimaryButton,
  SecondaryButton,
  TextArea,
  TextInput,
  linkClass,
  useToast,
} from '../components/ui';

/**
 * The server's own body cap — `express.json({ limit: '256kb' })` in app.ts.
 * Checked here so an oversized document is caught with the file in hand rather
 * than after a round trip, and so the number quoted is the one that applies.
 * A schedule this size is a wrong file: the whole VoTC programme is 31 KB.
 */
const MAX_BYTES = 256 * 1024;

const asKb = (bytes: number): string => `${Math.round(bytes / 1024)} KB`;

/** What the request will weigh. Not `text.length`: “Jörg” and “→” are not one
 *  byte each, and the cap the server applies is on bytes. */
const byteLength = (text: string): number => new TextEncoder().encode(text).length;

const plural = (n: number, one: string, many = `${one}s`): string =>
  `${n} ${n === 1 ? one : many}`;

/**
 * Import a schedule.
 *
 * The route this drives has existed for a while and was curl-only, which is
 * fine for the person who runs the server and no use at all to the person who
 * has the schedule — usually an organiser with a booklet, a spreadsheet and no
 * terminal. Everything here is in service of that person seeing what a document
 * would do before it does it.
 *
 * Hence the shape: paste, **check**, then import, with the check not optional.
 * The dry run is the same transaction rolled back at the end, so the counts and
 * warnings on screen are the ones the real import would produce, not a
 * prediction of them. Importing is only offered once a rehearsal of *that exact
 * text* has succeeded — editing the box withdraws the offer, because a result
 * that no longer describes what is in the box is worse than no result.
 */
export function ImportPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const fileInput = useRef<HTMLInputElement>(null);

  const [instanceKey, setInstanceKey] = useState('');
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'check' | 'import' | null>(null);
  /** The dry run, and the exact text it was run against. */
  const [checked, setChecked] = useState<{ text: string; result: ImportResult } | null>(null);
  const [done, setDone] = useState<{ slug: string; generated: GeneratedPasswords } | null>(null);

  const parsed = parseDoc(text);
  const summary: DocSummary | null = parsed.ok ? parsed.summary : null;
  // A paste can be over the cap just as a file can, and the server would answer
  // 413 for both. Saying so here costs nothing and keeps the button honest.
  const bytes = byteLength(text);
  const oversize = bytes > MAX_BYTES;
  /** A result only describes the box while the box still says what it said. */
  const rehearsal = checked && checked.text === text ? checked.result : null;

  const readFile = (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_BYTES) {
      setError(
        `${file.name} is ${asKb(file.size)}, and this server accepts ${asKb(MAX_BYTES)}. ` +
          'That is far larger than any programme — check it is the right file.',
      );
      return;
    }
    void file.text().then((contents) => {
      setText(contents);
      setError(null);
      setChecked(null);
    });
  };

  const run = async (dryRun: boolean) => {
    if (!parsed.ok || oversize) return;
    setBusy(dryRun ? 'check' : 'import');
    setError(null);
    try {
      const result = await api.importEvent(instanceKey, parsed.doc, { dryRun });
      if (dryRun) {
        setChecked({ text, result });
        setBusy(null);
        return;
      }
      const generated = result.generatedPasswords ?? {};
      if (Object.keys(generated).length > 0) {
        // Hashed on the way in, so this is the only chance to read them.
        setDone({ slug: result.slug, generated });
        setBusy(null);
        return;
      }
      toast.show('Schedule imported — you are its admin');
      navigate(`/e/${result.slug}`);
    } catch (err) {
      // A slug collision is the one failure with an obvious fix, and the
      // message alone ("That slug is already taken") does not say where.
      const message =
        err instanceof ApiError && err.code === 'slug_taken'
          ? `${err.message}. Change "slug" in the document to something free.`
          : (err as Error).message;
      setError(message);
      setBusy(null);
    }
  };

  if (done) {
    const rows: [string, string | undefined][] = [
      ['Viewer', done.generated.viewerPassword],
      ['Attendee', done.generated.userPassword],
      ['Admin', done.generated.adminPassword],
    ];
    return (
      <div className="mx-auto max-w-lg px-4 py-10">
        <h1 className="mb-1 text-lg font-semibold tracking-tight">Schedule imported</h1>
        <p className="mb-5 text-sm text-stone-500 dark:text-stone-400">
          You are its admin already. These passwords were generated for the roles the
          document left blank — <strong>write them down now</strong>. They are stored
          hashed, so this screen is the only place they can be read.
        </p>
        <dl className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm dark:border-stone-700 dark:bg-stone-900">
          {rows.map(([label, value]) =>
            value ? (
              <div key={label} className="mb-3 last:mb-0">
                <dt className="text-xs font-medium text-stone-600 dark:text-stone-300">{label}</dt>
                <dd className="mt-1 select-all break-all font-mono text-sm">{value}</dd>
              </div>
            ) : null,
          )}
        </dl>
        <PrimaryButton
          className="mt-4 w-full py-2 text-sm"
          onClick={() => navigate(`/e/${done.slug}`)}
        >
          I have written them down — open the event
        </PrimaryButton>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <Link to="/events" className={`text-xs ${linkClass} underline`}>
        ← All events
      </Link>
      <h1 className="mb-1 mt-3 text-lg font-semibold tracking-tight">Import a schedule</h1>
      <p className="mb-5 text-sm text-stone-500 dark:text-stone-400">
        Builds a whole event — rooms, tracks, breaks and a full grid of sessions — from
        one JSON document. The document is written the way a schedule is <em>printed</em>:
        room names and wall-clock times, no ids. Nothing is written until you have checked
        it and said so.
      </p>

      <div className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm dark:border-stone-700 dark:bg-stone-900">
        <Field
          label="Instance password"
          hint="Set by whoever runs this server. Importing makes an event rather than editing one, so it asks for the same password creating one by hand does — not an event password."
        >
          <ControlShell>
            <TextInput
              type="password"
              value={instanceKey}
              onChange={(e) => setInstanceKey(e.target.value)}
            />
          </ControlShell>
        </Field>

        <div className="mt-4">
          <div className="mb-1.5 flex items-baseline justify-between gap-3">
            <span className="text-xs font-medium text-stone-600 dark:text-stone-300">
              The document
            </span>
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              className={`${linkClass} text-xs underline`}
            >
              Choose a file…
            </button>
            <input
              ref={fileInput}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => {
                readFile(e.target.files?.[0]);
                // Same file twice in a row must fire change again.
                e.target.value = '';
              }}
            />
          </div>
          <TextArea
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setError(null);
            }}
            spellCheck={false}
            rows={14}
            placeholder={'{\n  "event": { "name": "…", "slug": "…" },\n  "rooms": [ … ]\n}'}
            className="resize-y font-mono text-xs leading-relaxed"
          />
          {text.trim() !== '' && !parsed.ok && (
            <p className="mt-2 text-xs text-red-600 dark:text-red-400">{parsed.error}</p>
          )}
          {oversize && (
            <p className="mt-2 text-xs text-red-600 dark:text-red-400">
              This document is {asKb(bytes)}, and this server accepts {asKb(MAX_BYTES)}.
            </p>
          )}
          {summary && <Summary summary={summary} />}
        </div>

        {error && <FormError className="mt-4">{error}</FormError>}
        {rehearsal && <Rehearsal result={rehearsal} />}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <SecondaryButton
            onClick={() => void run(true)}
            disabled={!parsed.ok || oversize || busy !== null || instanceKey === ''}
          >
            {busy === 'check' ? 'Checking…' : rehearsal ? 'Check again' : 'Check it'}
          </SecondaryButton>
          <PrimaryButton
            onClick={() => void run(false)}
            disabled={!rehearsal || oversize || busy !== null}
            title={rehearsal ? undefined : 'Check the document first'}
          >
            {busy === 'import' ? 'Importing…' : 'Import'}
          </PrimaryButton>
          {!rehearsal && parsed.ok && !oversize && (
            <span className="text-xs text-stone-500 dark:text-stone-400">
              Check it first — nothing is written until then.
            </span>
          )}
        </div>
      </div>

      <p className="mt-4 text-xs text-stone-500 dark:text-stone-400">
        Rather create an empty event and fill it in by hand?{' '}
        <Link to="/new" className={`${linkClass} underline`}>
          Create an event
        </Link>
        .
      </p>
    </div>
  );
}

/** What is in the box, read locally. Not a verdict — that is the dry run's. */
function Summary({ summary }: { summary: DocSummary }) {
  const parts = [
    plural(summary.rooms, 'room'),
    plural(summary.tracks, 'track'),
    plural(summary.sessions, 'session'),
    ...(summary.breaks > 0 ? [plural(summary.breaks, 'break')] : []),
    ...(summary.tags > 0 ? [plural(summary.tags, 'tag')] : []),
    ...(summary.speakers > 0 ? [plural(summary.speakers, 'speaker')] : []),
  ];
  return (
    <div className="mt-2 text-xs text-stone-500 dark:text-stone-400">
      <span className="font-medium text-stone-700 dark:text-stone-200">
        {summary.name ?? 'Untitled'}
      </span>
      {summary.slug && <span className="font-mono"> /e/{summary.slug}</span>}
      {summary.dates && (
        <span>
          {' · '}
          {summary.dates[0]} → {summary.dates[1]}
        </span>
      )}
      {summary.timezone && <span> · {summary.timezone}</span>}
      <br />
      {parts.join(' · ')}
    </div>
  );
}

/** The dry run's answer: what would land, and what deserves a second look. */
function Rehearsal({ result }: { result: ImportResult }) {
  const { counts, warnings } = result;
  const rows: [string, number][] = [
    ['Rooms', counts.rooms],
    ['Tracks', counts.tracks],
    ['Tags', counts.tags],
    ['Breaks', counts.breaks],
    ['Sessions', counts.sessions],
    ['Profiles', counts.people],
  ];
  return (
    <div className="mt-4 rounded-xl border border-stone-200 bg-stone-50 p-4 dark:border-stone-700 dark:bg-stone-950/40">
      <p className="text-xs font-semibold text-stone-700 dark:text-stone-200">
        Checked — nothing was written. This is what importing would put on the grid:
      </p>
      <dl className="mt-3 grid grid-cols-3 gap-3 sm:grid-cols-6">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt className="text-[0.65rem] uppercase tracking-wide text-stone-400 dark:text-stone-500">
              {label}
            </dt>
            <dd className="text-sm font-semibold tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      {warnings.length > 0 && (
        <div className="mt-3 border-t border-stone-200 pt-3 dark:border-stone-700">
          <p className="text-xs font-semibold text-amber-700 dark:text-amber-400">
            {plural(warnings.length, 'thing')} worth a second look — none of them stop the
            import:
          </p>
          <ul className="mt-1.5 list-disc space-y-1 pl-4 text-xs text-stone-600 dark:text-stone-300">
            {warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
