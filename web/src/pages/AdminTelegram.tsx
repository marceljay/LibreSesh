import { useCallback, useEffect, useRef, useState } from 'react';
import type { EventDto, RoomDto, SessionDto, TelegramStatus } from '@shared/types';
import { api } from '../lib/api';
import { errorText } from '../lib/errorText';
import { parseNumberField, telegramLeadField } from '../lib/numberField';
import { FieldInfo } from '../components/FieldInfo';
import { checkTemplate, PLACEHOLDERS, type TemplateProblem } from '@shared/telegramTemplate';
import { TimeField } from '../components/TimeField';
import { fmtMin, minutesOf } from '../lib/format';
import { Line, sampleRow, TelegramPreview } from '../components/TelegramPreview';
import {
  ControlShell,
  Field,
  FieldGroup,
  FormError,
  FormRow,
  FormStack,
  InlineForm,
  NumberField,
  PrimaryButton,
  SecondaryButton,
  Section,
  TextArea,
  TextInput,
  useToast,
} from '../components/ui';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';

const DOCS = 'https://github.com/marceljay/LibreSesh/blob/main/docs/managing.md#telegram';

/**
 * The presets, quietest first, worded as what the group experiences.
 *
 * Each one names something the bot actually does. The list was two rungs long
 * while the digest and the change messages were unwritten, because a setting
 * called "one message each morning" that sent nothing is worse than a short
 * list.
 */
const MODES = [
  { id: 'off', label: 'Off — connected, but silent' },
  { id: 'light', label: 'Light — what is starting next' },
  { id: 'medium', label: 'Medium — that, the morning’s programme, and pitches as they land' },
  { id: 'heavy', label: 'Heavy — that, plus every session added or moved' },
];

/**
 * The line a session renders as, written by the organiser.
 *
 * Ticking parts in a chosen order was still our sentence with their words in
 * it — it could not say "Annnoooounciiiiiing: Repair café". This can. The
 * grammar stays two things, because a third is where a template box turns into
 * a language nobody can debug from a phone at a conference.
 */
/**
 * What is wrong with the line, in a sentence.
 *
 * The same three cases `errorText` answers for the route's codes — said here
 * as it is typed, so nobody presses Save to find out.
 */
function templateMessage(problem: TemplateProblem): string {
  if (problem.code === 'unbalanced') return 'Every [ needs a matching ]';
  if (problem.code === 'too_long') return 'That line is too long';
  return problem.name
    ? `There is no “{${problem.name}}” to fill in — see the list below`
    : 'That line uses something there is no value for';
}

/** The small pill the token and preset buttons wear. One class, because a row
 *  of buttons that do not match reads as a row of unrelated things. */
const chipClass =
  'rounded-full border border-stone-300 px-2 py-0.5 font-mono text-xs text-stone-600 hover:border-stone-500 hover:text-stone-900 dark:border-stone-600 dark:text-stone-300 dark:hover:text-stone-100';

/** A starting point for anybody who does not want to write one. */
const PRESETS: { label: string; template: string }[] = [
  { label: 'Title and speakers', template: '{title}[, by {speakers}]' },
  { label: 'With the room', template: '{room} · {title}[, by {speakers}]' },
  {
    label: 'Everything',
    template: '{room} · {title}[, by {speakers}][ · {format}][ {tags}][\nStream: {streams}]',
  },
];

const modeLabel = (id: string): string =>
  MODES.find((m) => m.id === id)?.label ?? 'Custom — a mix of your own';

/** Hours and minutes. A code that dies in fifteen minutes does not need
 *  seconds, and `toLocaleTimeString()` alone prints them. */
const clock = (iso: string): string =>
  new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/**
 * Connecting an event to a Telegram group.
 *
 * Two things here work differently from the rest of Manage Event, and both are
 * deliberate. The group is never typed in — a private group has no `@name` and
 * its numeric id is not something an organiser can find without going off to a
 * third-party bot, so they say a code in the group and the bot reads its own
 * `chat.id` off that message. And the settings carry an **example**, because
 * this is the one screen whose effect cannot be seen from the screen: it
 * arrives in somebody else's Telegram, tomorrow.
 *
 * The bot and the group are *actions* — saving a token, minting a code,
 * disconnecting — and take effect when their button is pressed. What it posts
 * is a *form*, and has one Save, like Breaks, Rooms and Settings. Choosing
 * that is deliberately available before a group is connected: deciding how
 * loud this will be, and seeing what that means, is how somebody works out
 * whether they want a group at all.
 */
export function AdminTelegram({
  slug,
  event,
  sessions,
  rooms,
  tracks = [],
  formats = [],
  tags = [],
}: {
  slug: string;
  event: EventDto;
  sessions: SessionDto[];
  rooms: RoomDto[];
  /** Only their names are wanted, to draw the fields the Example shows. */
  tracks?: { id: number; name: string }[];
  formats?: { id: number; name: string }[];
  tags?: { id: number; name: string }[];
}) {
  const toast = useToast();
  const [status, setStatus] = useState<TelegramStatus | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [lead, setLead] = useState('15');
  const [mode, setMode] = useState('off');
  const [template, setTemplate] = useState('');
  const [digest, setDigest] = useState('08:00');
  const boxRef = useRef<HTMLTextAreaElement>(null);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [previewing, setPreviewing] = useState(false);

  const load = useCallback(async () => {
    try {
      const next = await api.telegram(slug);
      setStatus(next);
      setLead(String(next.leadMin));
      setMode(next.mode);
      setTemplate(next.template);
      setDigest(fmtMin(next.digestMin));
    } catch (err) {
      setProblem(errorText(err));
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Answers whether it worked, so a caller can keep what the person typed
   *  when it did not — a rejected token must still be there to correct. */
  const run = async (work: () => Promise<TelegramStatus>, done?: string): Promise<boolean> => {
    setBusy(true);
    setProblem(null);
    try {
      const next = await work();
      setStatus(next);
      setLead(String(next.leadMin));
      setMode(next.mode);
      setTemplate(next.template);
      setDigest(fmtMin(next.digestMin));
      if (done) toast.show(done);
      return true;
    } catch (err) {
      setProblem(errorText(err));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setBusy(true);
    setProblem(null);
    try {
      await api.telegramTest(slug);
      toast.show('Sent. Check the group.');
    } catch (err) {
      // Telegram's own words, deliberately: "bot was kicked from the group
      // chat" is the whole diagnosis, and anything we write instead is worse.
      setProblem(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  if (!status) return null;

  const saveToken = () => {
    if (token.trim() === '') return;
    void run(() => api.telegramSettings(slug, { botToken: token.trim() }), 'Bot saved.').then(
      (ok) => {
        if (ok) setToken('');
      },
    );
  };

  const parsedLead = parseNumberField(lead, telegramLeadField);
  const digestMin = minutesOf(digest);
  // Checked as it is typed, with the same function the route refuses it by, so
  // the box never disagrees with the answer Save would give.
  const badTemplate = checkTemplate(template);
  const templateProblem = badTemplate === null ? null : templateMessage(badTemplate);
  const row = sampleRow(event, sessions, rooms, tracks, formats, tags);
  const usingRealData = sessions.some((session) => !session.draft);
  const dirty =
    mode !== status.mode ||
    template !== status.template ||
    digestMin !== status.digestMin ||
    (parsedLead.value !== null && parsedLead.value !== status.leadMin);

  /**
   * One Save for both, like every other form on this page. Nothing here saves
   * itself: Breaks has a Save, Rooms has *Save room*, Settings has *Save
   * settings*, and a screen that quietly committed a choice the moment it was
   * picked would be the only one that did.
   */
  /**
   * Put a token where the caret is, and leave the caret after it.
   *
   * Typing `{speakers}` by hand means knowing the list and spelling it; every
   * misspelling is a save that gets refused. A click cannot misspell, and
   * landing the caret afterwards is what keeps it a writing tool rather than a
   * thing that scatters tokens at the end of the line.
   */
  const insert = (token: string, wrap = false) => {
    const box = boxRef.current;
    if (!box) {
      setTemplate((current) => current + token);
      return;
    }
    const from = box.selectionStart ?? template.length;
    const to = box.selectionEnd ?? from;
    const selected = template.slice(from, to);
    // A bracket pair around a selection is the common move: mark the part that
    // should vanish when it is empty, rather than retyping it inside brackets.
    const inserted = wrap ? `[${selected}]` : token;
    setTemplate(template.slice(0, from) + inserted + template.slice(to));
    // Empty brackets want the caret inside them, ready to type; everything
    // else wants it after what just landed.
    const caret = wrap && selected === '' ? from + 1 : from + inserted.length;
    // After React has written the value, or the range lands on the old one.
    requestAnimationFrame(() => {
      box.focus();
      box.setSelectionRange(caret, caret);
    });
  };

  const saveOptions = () => {
    if (!dirty || parsedLead.error || templateProblem) return;
    void run(
      () =>
        api.telegramSettings(slug, {
          mode,
          template,
          digestMin,
          ...(parsedLead.value !== null ? { leadMin: parsedLead.value } : {}),
        }),
      'Saved.',
    );
  };

  return (
    <Section
      title="Telegram"
      description="Announce this event’s schedule into a Telegram group."
      className="mb-6"
    >
      {problem && <FormError className="mb-4">{problem}</FormError>}

      <FormStack>
        <FieldGroup title="The bot and the group">
          {status.ownBot ? (
            <Field
              label="Bot"
              hint="Saved, and not readable again. Remove it to use a different one."
              action={
                <FieldInfo label="About the bot" href={DOCS}>
                  <p>
                    The bot is the account that posts for you. This event has its own, so the group
                    sees your conference’s name rather than whoever runs this instance.
                  </p>
                </FieldInfo>
              }
            >
              <div className="flex flex-wrap items-center gap-2">
                <ControlShell className="flex-1">
                  <span className="font-mono text-sm text-stone-600 dark:text-stone-300">
                    {status.ownBotHint}
                  </span>
                </ControlShell>
                <SecondaryButton
                  disabled={busy}
                  onClick={() =>
                    void run(
                      () => api.telegramSettings(slug, { botToken: null }),
                      status.instanceBot ? 'Back to the shared bot.' : 'Bot removed.',
                    )
                  }
                >
                  Remove
                </SecondaryButton>
              </div>
            </Field>
          ) : (
            <InlineForm className="contents" onSubmit={saveToken}>
              <Field
                label="Bot"
                hint={
                  status.instanceBot
                    ? 'This instance provides a bot, so you can leave this empty. Paste your own to post under your event’s name instead.'
                    : 'Message @BotFather in Telegram, send /newbot, and paste back the token it gives you.'
                }
                action={
                  <FieldInfo label="About the bot" href={DOCS}>
                    <p>
                      The bot is the account that posts for you. You make it yourself in Telegram —
                      message <strong>@BotFather</strong>, send <strong>/newbot</strong>, and it
                      hands you a token.
                    </p>
                    <p className="mt-2">
                      The token stays on the server and is never shown again. Anyone holding it can
                      post as that bot, so treat it like a password.
                    </p>
                  </FieldInfo>
                }
              >
                <div className="flex flex-wrap items-center gap-2">
                  <ControlShell className="flex-1">
                    <TextInput
                      value={token}
                      placeholder="123456789:AA…"
                      autoComplete="off"
                      spellCheck={false}
                      className="w-full"
                      onChange={(e) => setToken(e.target.value)}
                    />
                  </ControlShell>
                  <PrimaryButton type="submit" disabled={busy || token.trim() === ''}>
                    Save bot
                  </PrimaryButton>
                </div>
              </Field>
            </InlineForm>
          )}

          {status.available && status.connected && (
            <Field
              label="Group"
              hint="Everyone in it sees these sessions — titles, speakers, rooms and times. Drafts are never posted, and the links still ask for the event password."
            >
              <div className="flex flex-wrap gap-2">
                <SecondaryButton disabled={busy} onClick={() => void test()}>
                  Send a test message
                </SecondaryButton>
                <SecondaryButton
                  disabled={busy}
                  onClick={() =>
                    void run(() => api.telegramDisconnect(slug), 'Disconnected from the group.')
                  }
                >
                  Disconnect
                </SecondaryButton>
              </div>
            </Field>
          )}

          {status.available && !status.connected && (
            <Field
              label="Group"
              hint={
                status.bindCode
                  ? `Send this line as an ordinary message in your Telegram group. That message is what tells the bot which group to post in.${
                      status.bindExpires ? ` Works once, expires ${clock(status.bindExpires)}.` : ''
                    }`
                  : 'Add the bot to your Telegram group first. Generating a code gives you a line to send as a message in that group — that message is what tells the bot which group to post in.'
              }
            >
              <div className="flex flex-wrap items-center gap-2">
                {status.bindCode && (
                  <ControlShell className="flex-1">
                    <TextInput
                      readOnly
                      aria-label="Message to send in your Telegram group"
                      className="w-full font-mono"
                      value={`/bind ${status.bindCode}`}
                    />
                  </ControlShell>
                )}
                <PrimaryButton
                  disabled={busy}
                  onClick={() => void run(() => api.telegramCode(slug))}
                >
                  {status.bindCode ? 'New code' : 'Generate a code'}
                </PrimaryButton>
              </div>
            </Field>
          )}
        </FieldGroup>

        {/* Not gated on a connected group. Deciding how loud this will be, and
          seeing what that means, is how somebody works out whether they want a
          group at all — hiding it until one is bound puts the decision after
          the commitment, and made these controls vanish when changing the bot
          cleared the binding. */}
        {status.available && (
          <InlineForm className="contents" onSubmit={saveOptions}>
            <FieldGroup title="What it posts">
              <Field
                label="How much it says"
                hint="A group is a conversation, and every announcement pushes it up the screen. Medium is the usual choice."
              >
                <Select value={mode} onValueChange={(v) => setMode(String(v))}>
                  <SelectTrigger aria-label="How much it says" className="w-full sm:w-96">
                    <SelectValue>{(v: string | null) => modeLabel(v ?? 'off')}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {MODES.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              <FormRow>
                <NumberField
                  label="How early it says it"
                  hint="Before each start time."
                  spec={telegramLeadField}
                  value={lead}
                  onChange={setLead}
                  suffix="minutes before"
                />
                {(mode === 'medium' || mode === 'heavy') && (
                  <Field label="Morning message" hint="On the venue’s clock, not the server’s.">
                    <TimeField value={digest} onChange={setDigest} aria-label="Digest time" />
                  </Field>
                )}
              </FormRow>
            </FieldGroup>

            <FieldGroup title="How a session reads">
              <Field
                label="The line"
                hint="Used in what-is-up-next, just-added and just-pitched. The morning digest and the moved note keep their own short shape — both list a whole day, so both stay one terse line a session."
                action={
                  <FieldInfo label="About the line" href={DOCS}>
                    <p>
                      Write it however you like. <code>{'{title}'}</code> and the rest are filled in
                      per session; everything else is your own words.
                    </p>
                    <p className="mt-2">
                      Square brackets are what stop “Repair café, by ” on a session with nobody
                      credited: <code>{'{title}[, by {speakers}]'}</code> drops the whole “, by …”
                      when there are no speakers. Select a part and press <strong>[ ]</strong> to
                      wrap it.
                    </p>
                    <p className="mt-2">
                      <code>{'{streams}'}</code> is the one that leaves the password gate — anyone
                      who can see the group can watch.
                    </p>
                  </FieldInfo>
                }
                error={templateProblem ?? undefined}
              >
                <ControlShell>
                  <TextArea
                    ref={boxRef}
                    rows={2}
                    value={template}
                    spellCheck={false}
                    className="w-full font-mono text-xs"
                    aria-label="The line each session renders as"
                    onChange={(e) => setTemplate(e.target.value)}
                  />
                </ControlShell>

                <div className="mt-2 flex flex-wrap items-center gap-1">
                  {PLACEHOLDERS.map((name) => (
                    <button
                      key={name}
                      type="button"
                      onClick={() => insert(`{${name}}`)}
                      className={chipClass}
                      title={`Put {${name}} where the cursor is`}
                    >
                      {`{${name}}`}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => insert('[]', true)}
                    className={chipClass}
                    title="Wrap the selected part in brackets, so it disappears when it is empty"
                  >
                    [ ]
                  </button>
                </div>
              </Field>

              {/* The line as typed, against this event's own schedule. Every
                other setting here can be checked by looking; this one used to
                need a save, a wait, and then a group of strangers. */}
              <div className="rounded-lg bg-stone-100 px-3 py-2 dark:bg-stone-800">
                <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-stone-500 dark:text-stone-400">
                  {usingRealData ? 'This event’s next session' : 'A stand-in session'}
                </p>
                <p className="text-sm leading-relaxed text-stone-800 dark:text-stone-100">
                  {templateProblem ? (
                    <span className="text-stone-500 dark:text-stone-400">—</span>
                  ) : (
                    <Line row={row} template={template} />
                  )}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-stone-500 dark:text-stone-400">Start from:</span>
                {PRESETS.map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => setTemplate(preset.template)}
                    className={chipClass}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </FieldGroup>

            <div className="flex flex-wrap items-center gap-2">
              <PrimaryButton type="submit" disabled={busy || !dirty || Boolean(templateProblem)}>
                Save
              </PrimaryButton>
              <SecondaryButton onClick={() => setPreviewing(true)}>
                Example of every message
              </SecondaryButton>
            </div>
          </InlineForm>
        )}
      </FormStack>

      {/* The mode and lead being *considered*, not the ones stored. The Example
        is how somebody decides whether to press Save, so answering it with
        what is already saved answers a question nobody asked. */}
      {previewing && (
        <TelegramPreview
          mode={mode}
          leadMin={parsedLead.value ?? status.leadMin}
          template={template}
          digest={digest}
          tracks={tracks}
          formats={formats}
          tags={tags}
          event={event}
          sessions={sessions}
          rooms={rooms}
          onClose={() => setPreviewing(false)}
        />
      )}
    </Section>
  );
}
