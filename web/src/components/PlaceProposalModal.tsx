import { Modal } from './Modal';
import { useMemo, useState } from 'react';
import type { ProposalDto, RoomDto, SessionDto } from '@shared/types';
import type { PlaceWrite } from '../lib/api';
import { fmtMin, minutesOf } from '../lib/format';
import { clashAt, clashLabel, roomBusy } from '../lib/roomAvailability';
import { zonedTimeToUtc } from '@shared/time';
import {
  DURATION_CHOICES,
  MAX_DURATION_MINUTES,
  MIN_DURATION_MINUTES,
  SNAP_MINUTES,
  durationLabel,
} from '@shared/sessionLimits';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { TimeField } from './TimeField';
import {
  ControlShell,
  Field,
  FormError,
  FormGrid,
  PrimaryButton,
  SecondaryButton,
  TextInput,
} from './ui';

export interface PlaceProposalModalProps {
  proposal: ProposalDto;
  rooms: RoomDto[];
  /** What is already on the grid, so the form can grey the slots it fills. */
  sessions: SessionDto[];
  timezone: string;
  days: string[];
  dayLabels: Record<string, string>;
  defaultDay: string;
  dayStartMin: number;
  dayEndMin: number;
  saving: boolean;
  onCancel: () => void;
  onPlace: (body: PlaceWrite) => void;
}

/** Organiser-only: turn a pitch into a real session by giving it a room and a
 *  slot. Fields mirror SessionModal, including the wall-clock → UTC conversion. */
export function PlaceProposalModal({
  proposal,
  rooms,
  sessions,
  timezone,
  days,
  dayLabels,
  defaultDay,
  dayStartMin,
  dayEndMin,
  saving,
  onCancel,
  onPlace,
}: PlaceProposalModalProps) {
  const [roomId, setRoomId] = useState<number>(rooms[0]?.id ?? 0);
  const [day, setDay] = useState(defaultDay);
  const [start, setStart] = useState(fmtMin(Math.max(dayStartMin, 14 * 60)));
  const [durMin, setDurMin] = useState(30);
  const [customDur, setCustomDur] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Placing a pitch is refused on an overlap whoever does it — the route runs
  // `assertNoOverlap` with no organiser exemption — so taken slots cannot be
  // picked here, and a typed one is stopped before the request.
  const busy = useMemo(() => roomBusy(sessions, { roomId }), [sessions, roomId]);
  const clash = clashAt(busy, day, minutesOf(start), durMin, timezone);

  const place = () => {
    if (!roomId) {
      setError('Add a room first');
      return;
    }
    if (clash) {
      setError('That slot is already taken in this room');
      return;
    }
    const [h, m] = start.split(':').map(Number);
    const startMin = Math.round(((h ?? 0) * 60 + (m ?? 0)) / 5) * 5;
    onPlace({
      roomId,
      startsAt: zonedTimeToUtc(day, startMin, timezone).toISOString(),
      endsAt: zonedTimeToUtc(day, startMin + durMin, timezone).toISOString(),
    });
  };

  return (
    <Modal
      title="Place on the grid"
      description={`“${proposal.title}” becomes a session. Its tags and speaker carry over.`}
      onClose={onCancel}
      onSubmit={place}
      footer={
        <>
          {error && <FormError className="basis-full">{error}</FormError>}
          <SecondaryButton onClick={onCancel}>Cancel</SecondaryButton>
          <PrimaryButton type="submit" disabled={saving || rooms.length === 0}>
            {saving ? 'Placing…' : 'Place session'}
          </PrimaryButton>
        </>
      }
    >
      <FormGrid>
        <Field label="Room">
          <Select value={roomId} onValueChange={(v) => v != null && setRoomId(v)}>
            <SelectTrigger aria-label="Room">
              <SelectValue>
                {(v: number | null) => rooms.find((r) => r.id === v)?.name ?? ''}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {rooms.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.name}
                  {r.openBooking ? ' (open)' : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Day">
          <Select value={day} onValueChange={(v) => v != null && setDay(v)}>
            <SelectTrigger aria-label="Day">
              <SelectValue>
                {(v: string | null) => (v == null ? '' : (dayLabels[v] ?? v))}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {days.map((d) => (
                <SelectItem key={d} value={d}>
                  {dayLabels[d] ?? d}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Start" hint="Type it, or pick a quarter hour.">
          <TimeField
            aria-label="Start"
            className="w-full"
            value={start}
            onChange={setStart}
            min={dayStartMin}
            max={dayEndMin}
            taken={(minute) => clashAt(busy, day, minute, durMin, timezone) !== null}
          />
        </Field>
        {/* Same list and same escape hatch as the session form: a pitch being
            placed is a session, and two dialogs that disagree about how long
            one may run would be a bug found at the worst moment. */}
        <Field label="Duration">
          <Select
            value={customDur ? 'other' : String(durMin)}
            onValueChange={(v) => {
              if (v === 'other') {
                setCustomDur(true);
                return;
              }
              if (v != null) {
                setCustomDur(false);
                setDurMin(Number(v));
              }
            }}
          >
            <SelectTrigger aria-label="Duration">
              <SelectValue>
                {(v: string | null) =>
                  v === 'other' ? 'Other…' : v == null ? '' : durationLabel(Number(v))
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {DURATION_CHOICES.map((d) => (
                <SelectItem
                  key={d}
                  value={String(d)}
                  disabled={clashAt(busy, day, minutesOf(start), d, timezone) !== null}
                >
                  {durationLabel(d)}
                </SelectItem>
              ))}
              <SelectItem value="other">Other…</SelectItem>
            </SelectContent>
          </Select>
          {customDur && (
            <ControlShell className="mt-1.5">
              <TextInput
                type="number"
                value={durMin}
                onChange={(e) => setDurMin(Number(e.target.value))}
                min={MIN_DURATION_MINUTES}
                max={MAX_DURATION_MINUTES}
                step={SNAP_MINUTES}
                aria-label="Duration in minutes"
                autoFocus
              />
            </ControlShell>
          )}
        </Field>
      </FormGrid>
      {clash && (
        <FormError className="mt-3">
          {clashLabel(clash, timezone)} is already in this room. Pick a free time, a shorter length
          or another room.
        </FormError>
      )}
    </Modal>
  );
}
