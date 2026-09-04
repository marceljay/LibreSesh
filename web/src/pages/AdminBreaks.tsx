import { useState } from 'react';
import type { BreakDto } from '@shared/types';
import type { BreakWrite } from '../lib/api';
import { fmtMin, minutesOf, snapMinute } from '../lib/format';
import {
  ControlShell,
  DangerButton,
  Field,
  FormRow,
  FormStack,
  Modal,
  PrimaryButton,
  SecondaryButton,
  Section,
  TextInput,
  selectClass,
} from '../components/ui';

const EVERY_DAY = '';

/** "Wed 2 Sep". Rendered in UTC because the date string *is* the day — it has
 *  no timezone of its own, and letting the browser's zone shift it would name
 *  the wrong one either side of midnight. */
export const dayName = (date: string): string =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });

/** The four fields a break has, shared by the add row and the editor. */
interface Draft {
  label: string;
  start: string;
  end: string;
  /** '' means every day. */
  date: string;
}

const draftOf = (item: BreakDto): Draft => ({
  label: item.label,
  start: fmtMin(item.startMin),
  end: fmtMin(item.endMin),
  date: item.date ?? EVERY_DAY,
});

const writeOf = (draft: Draft): BreakWrite => ({
  label: draft.label.trim(),
  startMin: snapMinute(minutesOf(draft.start)),
  endMin: snapMinute(minutesOf(draft.end)),
  date: draft.date === EVERY_DAY ? null : draft.date,
});

const valid = (draft: Draft): boolean =>
  draft.label.trim().length > 0 && minutesOf(draft.end) > minutesOf(draft.start);

function DayPicker({
  value,
  days,
  onChange,
}: {
  value: string;
  days: string[];
  onChange: (next: string) => void;
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={selectClass}>
      <option value={EVERY_DAY}>Every day</option>
      {days.map((date) => (
        <option key={date} value={date}>
          {dayName(date)}
        </option>
      ))}
    </select>
  );
}

export interface AdminBreaksProps {
  breaks: BreakDto[];
  /** Every date the event runs, for the day picker. */
  days: string[];
  onCreate: (draft: BreakWrite) => Promise<boolean>;
  onPatch: (item: BreakDto, draft: BreakWrite) => Promise<boolean>;
  onDelete: (item: BreakDto) => Promise<boolean>;
}

/**
 * Lunch, dinner, coffee — the parts of the day that belong to the whole event.
 *
 * They live here rather than in the session form because that is what they
 * are: nobody hosts lunch, it is not in a room, and it is the same every day
 * unless the organiser says otherwise. On the schedule they are drawn behind
 * everything and cannot be clicked; this page is the only place they are
 * edited.
 */
export function AdminBreaks({ breaks, days, onCreate, onPatch, onDelete }: AdminBreaksProps) {
  const [draft, setDraft] = useState<Draft>({
    label: '',
    start: '12:00',
    end: '13:00',
    date: EVERY_DAY,
  });
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<BreakDto | null>(null);

  const add = async () => {
    if (!valid(draft) || busy) return;
    setBusy(true);
    try {
      if (await onCreate(writeOf(draft))) {
        setDraft({ label: '', start: draft.start, end: draft.end, date: EVERY_DAY });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section
      title="Breaks"
      description="Lunch, dinner, the coffee break. They belong to the event rather than to a room, so they are drawn as a quiet band across the whole schedule — visible, so nobody books over one by accident, and not clickable, because there is nothing to open. A break stops nothing: a session may still run through it."
      className="mb-6"
    >
      <FormStack>
        {breaks.length > 0 ? (
          <ul className="space-y-2">
            {breaks.map((item) => (
              <li
                key={item.id}
                className="flex items-center gap-3 rounded-lg bg-stone-50 px-3 py-2 dark:bg-stone-800"
              >
                <p className="min-w-0 flex-1 truncate text-sm font-medium">{item.label}</p>
                <span className="shrink-0 text-xs tabular-nums text-stone-500 dark:text-stone-400">
                  {fmtMin(item.startMin)}–{fmtMin(item.endMin)}
                </span>
                <span className="shrink-0 text-xs text-stone-500 dark:text-stone-400">
                  {item.date === null ? 'every day' : dayName(item.date)}
                </span>
                <SecondaryButton className="shrink-0 px-3 py-1.5" onClick={() => setEditing(item)}>
                  Edit
                </SecondaryButton>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-stone-400 dark:text-stone-500">
            No breaks. Add “Lunch, 12:00–14:00, every day” and it appears on every day of the
            schedule.
          </p>
        )}

        <FormRow>
          <div className="min-w-40 flex-1">
            <Field label="New break">
              <ControlShell>
                <TextInput
                  value={draft.label}
                  onChange={(e) => setDraft({ ...draft, label: e.target.value })}
                  onKeyDown={(e) => e.key === 'Enter' && void add()}
                  placeholder="Lunch"
                  maxLength={60}
                />
              </ControlShell>
            </Field>
          </div>
          <Field label="From">
            <ControlShell>
              <TextInput
                type="time"
                step={300}
                value={draft.start}
                onChange={(e) => setDraft({ ...draft, start: e.target.value })}
              />
            </ControlShell>
          </Field>
          <Field label="To">
            <ControlShell>
              <TextInput
                type="time"
                step={300}
                value={draft.end}
                onChange={(e) => setDraft({ ...draft, end: e.target.value })}
              />
            </ControlShell>
          </Field>
          <Field label="Day">
            <DayPicker
              value={draft.date}
              days={days}
              onChange={(date) => setDraft({ ...draft, date })}
            />
          </Field>
          <PrimaryButton onClick={() => void add()} disabled={!valid(draft) || busy}>
            Add break
          </PrimaryButton>
        </FormRow>
      </FormStack>

      {editing && (
        <BreakEditor
          item={editing}
          days={days}
          onPatch={onPatch}
          onDelete={onDelete}
          onClose={() => setEditing(null)}
        />
      )}
    </Section>
  );
}

function BreakEditor({
  item,
  days,
  onPatch,
  onDelete,
  onClose,
}: {
  item: BreakDto;
  days: string[];
  onPatch: (item: BreakDto, draft: BreakWrite) => Promise<boolean>;
  onDelete: (item: BreakDto) => Promise<boolean>;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(draftOf(item));
  const [busy, setBusy] = useState(false);

  const original = draftOf(item);
  const dirty =
    draft.label.trim() !== original.label ||
    draft.start !== original.start ||
    draft.end !== original.end ||
    draft.date !== original.date;

  const save = async () => {
    if (!valid(draft) || busy) return;
    setBusy(true);
    try {
      if (await onPatch(item, writeOf(draft))) onClose();
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (await onDelete(item)) onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Edit break"
      onClose={onClose}
      onSubmit={() => void save()}
      footer={
        <>
          <DangerButton className="mr-auto" onClick={() => void remove()} disabled={busy}>
            Delete
          </DangerButton>
          <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
          <PrimaryButton type="submit" disabled={!valid(draft) || !dirty || busy}>
            Save
          </PrimaryButton>
        </>
      }
    >
      <FormStack>
        <Field label="Name">
          <ControlShell>
            <TextInput
              value={draft.label}
              onChange={(e) => setDraft({ ...draft, label: e.target.value })}
              maxLength={60}
              autoFocus
            />
          </ControlShell>
        </Field>
        <FormRow>
          <Field label="From">
            <ControlShell>
              <TextInput
                type="time"
                step={300}
                value={draft.start}
                onChange={(e) => setDraft({ ...draft, start: e.target.value })}
              />
            </ControlShell>
          </Field>
          <Field label="To">
            <ControlShell>
              <TextInput
                type="time"
                step={300}
                value={draft.end}
                onChange={(e) => setDraft({ ...draft, end: e.target.value })}
              />
            </ControlShell>
          </Field>
          <div className="min-w-40 flex-1">
            <Field label="Day">
              <DayPicker
                value={draft.date}
                days={days}
                onChange={(date) => setDraft({ ...draft, date })}
              />
            </Field>
          </div>
        </FormRow>
      </FormStack>
    </Modal>
  );
}
