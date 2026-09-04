import { useState } from 'react';
import type { ProposalDto, RoomDto } from '@shared/types';
import type { PlaceWrite } from '../lib/api';
import { fmtMin } from '../lib/format';
import { zonedTimeToUtc } from '@shared/time';
import {
  DURATION_CHOICES,
  MAX_DURATION_MINUTES,
  MIN_DURATION_MINUTES,
  SNAP_MINUTES,
  durationLabel,
} from '@shared/sessionLimits';
import {
  ControlShell,
  Field,
  FormError,
  FormGrid,
  Modal,
  PrimaryButton,
  SecondaryButton,
  TextInput,
  selectClass,
} from './ui';


export interface PlaceProposalModalProps {
  proposal: ProposalDto;
  rooms: RoomDto[];
  timezone: string;
  days: string[];
  dayLabels: Record<string, string>;
  defaultDay: string;
  dayStartMin: number;
  saving: boolean;
  onCancel: () => void;
  onPlace: (body: PlaceWrite) => void;
}

/** Organiser-only: turn a pitch into a real session by giving it a room and a
 *  slot. Fields mirror SessionModal, including the wall-clock → UTC conversion. */
export function PlaceProposalModal({
  proposal,
  rooms,
  timezone,
  days,
  dayLabels,
  defaultDay,
  dayStartMin,
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

  const place = () => {
    if (!roomId) {
      setError('Add a room first');
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
          <select
            value={roomId}
            onChange={(e) => setRoomId(Number(e.target.value))}
            className={selectClass}
          >
            {rooms.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
                {r.openBooking ? ' (open)' : ''}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Day">
          <select value={day} onChange={(e) => setDay(e.target.value)} className={selectClass}>
            {days.map((d) => (
              <option key={d} value={d}>
                {dayLabels[d] ?? d}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Start" hint="In 5-minute steps.">
          <ControlShell>
            <TextInput
              type="time"
              step={300}
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
          </ControlShell>
        </Field>
        {/* Same list and same escape hatch as the session form: a pitch being
            placed is a session, and two dialogs that disagree about how long
            one may run would be a bug found at the worst moment. */}
        <Field label="Duration">
          <select
            value={customDur ? 'other' : durMin}
            onChange={(e) => {
              if (e.target.value === 'other') {
                setCustomDur(true);
                return;
              }
              setCustomDur(false);
              setDurMin(Number(e.target.value));
            }}
            className={selectClass}
          >
            {DURATION_CHOICES.map((d) => (
              <option key={d} value={d}>
                {durationLabel(d)}
              </option>
            ))}
            <option value="other">Other…</option>
          </select>
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
    </Modal>
  );
}
