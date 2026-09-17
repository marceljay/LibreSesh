import { useCallback, useEffect, useState } from 'react';
import type { EventDto, RoomDto, SessionDto, TelegramStatus } from '@shared/types';
import { api } from '../lib/api';
import { errorText } from '../lib/errorText';
import { parseNumberField, telegramLeadField } from '../lib/numberField';
import { FieldInfo } from '../components/FieldInfo';
import { TimeField } from '../components/TimeField';
import { fmtMin, minutesOf } from '../lib/format';
import { TelegramPreview } from '../components/TelegramPreview';
import {
  ControlShell,
  Field,
  FormError,
  FormStack,
  InlineForm,
  NumberField,
  PrimaryButton,
  SecondaryButton,
  Section,
  TextInput,
  Toggle,
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
 * What a session's line may carry besides its title.
 *
 * Checkboxes rather than a template box: the order and the punctuation are a
 * rendering problem, and owning a template language to let somebody move the
 * room behind the title would buy a rearrangement nobody has asked for at the
 * price of empty placeholders and a line that breaks on the day. What people
 * want is the format shown, or the room left out.
 */
const FIELDS: { id: string; label: string; hint?: string }[] = [
  { id: 'room', label: 'Room' },
  { id: 'track', label: 'Track' },
  { id: 'speakers', label: 'Speakers' },
  { id: 'format', label: 'Format' },
  { id: 'tags', label: 'Tags' },
  {
    id: 'livestreams',
    label: 'Livestream links',
    hint: 'Anyone who sees the group can watch — a stream address does not ask for the event password.',
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
  const [fields, setFields] = useState<string[]>([]);
  const [digest, setDigest] = useState('08:00');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [previewing, setPreviewing] = useState(false);

  const load = useCallback(async () => {
    try {
      const next = await api.telegram(slug);
      setStatus(next);
      setLead(String(next.leadMin));
      setMode(next.mode);
      setFields(next.fields);
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
      setFields(next.fields);
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
  const sameFields =
    fields.length === status.fields.length && fields.every((f) => status.fields.includes(f));
  const dirty =
    mode !== status.mode ||
    !sameFields ||
    digestMin !== status.digestMin ||
    (parsedLead.value !== null && parsedLead.value !== status.leadMin);

  /**
   * One Save for both, like every other form on this page. Nothing here saves
   * itself: Breaks has a Save, Rooms has *Save room*, Settings has *Save
   * settings*, and a screen that quietly committed a choice the moment it was
   * picked would be the only one that did.
   */
  const saveOptions = () => {
    if (!dirty || parsedLead.error) return;
    void run(
      () =>
        api.telegramSettings(slug, {
          mode,
          fields,
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
                    message <strong>@BotFather</strong>, send <strong>/newbot</strong>, and it hands
                    you a token.
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
              <PrimaryButton disabled={busy} onClick={() => void run(() => api.telegramCode(slug))}>
                {status.bindCode ? 'New code' : 'Generate a code'}
              </PrimaryButton>
            </div>
          </Field>
        )}

        {/* Not gated on a connected group. Deciding how loud this will be, and
          seeing what that means, is how somebody works out whether they want a
          group at all — hiding it until one is bound puts the decision after
          the commitment, and made these controls vanish when changing the bot
          cleared the binding. */}
        {status.available && (
          <InlineForm className="contents" onSubmit={saveOptions}>
            <Field
              label="How much it says"
              hint="A group is a conversation, and every announcement pushes it up the screen. Medium is the usual choice."
              action={
                <FieldInfo label="About what it posts" href={DOCS}>
                  <p>
                    Each setting sends a different set of messages. <strong>Example</strong> shows
                    exactly what this one would post, using your own schedule.
                  </p>
                </FieldInfo>
              }
            >
              <div className="flex flex-wrap items-center gap-2">
                <Select value={mode} onValueChange={(v) => setMode(String(v))}>
                  <SelectTrigger aria-label="How much it says" className="w-72">
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
                <SecondaryButton onClick={() => setPreviewing(true)}>Example</SecondaryButton>
              </div>
            </Field>

            {(mode === 'medium' || mode === 'heavy') && (
              <Field
                label="When the morning message goes out"
                hint="The venue’s clock, not the server’s. Missed by more than an hour — a restart mid-morning, say — and that day’s is skipped rather than arriving late."
              >
                <TimeField value={digest} onChange={setDigest} aria-label="Digest time" />
              </Field>
            )}

            <NumberField
              label="How early it says it"
              hint="Before each start time. Everything starting at once goes out in a single message, however many rooms that is."
              spec={telegramLeadField}
              value={lead}
              onChange={setLead}
              suffix="minutes before"
            />

            <Field
              label="What each line says"
              hint="Besides the title, which is always there. A session shows only what it has — no format picked, no format shown."
              action={
                <FieldInfo label="About what a line says" href={DOCS}>
                  <p>
                    Each session in a message is one line: where it is, its title, who is giving it,
                    and whatever else you tick here. <strong>Example</strong> shows the result.
                  </p>
                  <p className="mt-2">
                    Livestream links add a second line, and are the one thing here that leaves the
                    password gate — anyone who can see the group can watch.
                  </p>
                </FieldInfo>
              }
            >
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3">
                {FIELDS.map((f) => (
                  <Toggle
                    key={f.id}
                    checked={fields.includes(f.id)}
                    title={f.hint}
                    onChange={(next) =>
                      setFields((prev) =>
                        next ? [...prev, f.id] : prev.filter((id) => id !== f.id),
                      )
                    }
                    label={f.label}
                  />
                ))}
              </div>
            </Field>

            <div>
              <PrimaryButton type="submit" disabled={busy || !dirty}>
                Save
              </PrimaryButton>
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
          fields={fields}
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
