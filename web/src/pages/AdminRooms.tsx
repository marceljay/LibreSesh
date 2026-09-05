import { useState } from "react";
import type { RoomDto } from "@shared/types";
import { ROOM_COLORS } from "@shared/roomColors";

import { ColorPicker } from "../components/ColorPicker";
import { capacityField, parseNumberField } from "../lib/numberField";
import {
  ControlShell,
  DangerButton,
  Field,
  FormGrid,
  FormRow,
  FormStack,
  IconButton,
  InlineForm,
  NumberField,
  PrimaryButton,
  SecondaryButton,
  Section,
  TextArea,
  TextInput,
  Toggle,
} from "../components/ui";

export interface AdminRoomsProps {
  rooms: RoomDto[];
  reordering: boolean;
  onCreate: (draft: RoomDraft) => Promise<void>;
  onPatch: (room: RoomDto, patch: Partial<RoomDto>) => Promise<void>;
  onMove: (index: number, direction: -1 | 1) => Promise<void>;
  onDelete: (room: RoomDto) => Promise<void>;
}

export interface RoomDraft {
  name: string;
  capacity: number | null;
  description: string;
  openBooking: boolean;
}


/** '' means "no capacity", which is a real state distinct from 0 — so a blank
 *  field parses to `null` with no complaint. A value the field cannot make a
 *  number of also parses to `null`, which is why saving is blocked on the
 *  error rather than on the value: `null` alone cannot tell "unset" from
 *  "wrong", and treating the second as the first would clear a capacity
 *  somebody was in the middle of typing. */
const parseCapacity = (raw: string) => parseNumberField(raw, capacityField);

const capacityLabel = (capacity: number | null): string =>
  capacity === null
    ? "no capacity set"
    : `${capacity} seat${capacity === 1 ? "" : "s"}`;

/**
 * One room. Collapsed it is a summary row; expanded it is a real form.
 *
 * The previous version put a borderless input in the row that saved on blur,
 * which gave no hint it was editable and no way to cancel — and left capacity
 * and description with no editor at all, even though the API has always
 * accepted both.
 */
function RoomRow({
  room,
  index,
  total,
  reordering,
  onPatch,
  onMove,
  onDelete,
}: {
  room: RoomDto;
  index: number;
  total: number;
  reordering: boolean;
  onPatch: (room: RoomDto, patch: Partial<RoomDto>) => Promise<void>;
  onMove: (index: number, direction: -1 | 1) => Promise<void>;
  onDelete: (room: RoomDto) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(room.name);
  const [capacity, setCapacity] = useState(
    room.capacity === null ? "" : String(room.capacity),
  );
  const [description, setDescription] = useState(room.description);
  const [color, setColor] = useState(room.color);
  const [openBooking, setOpenBooking] = useState(room.openBooking);
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setName(room.name);
    setCapacity(room.capacity === null ? "" : String(room.capacity));
    setDescription(room.description);
    setColor(room.color);
    setOpenBooking(room.openBooking);
  };

  const parsedCapacity = parseCapacity(capacity);

  const dirty =
    name.trim() !== room.name ||
    parsedCapacity.value !== room.capacity ||
    description.trim() !== room.description ||
    color !== room.color ||
    openBooking !== room.openBooking;

  const save = async () => {
    if (!name.trim() || parsedCapacity.error || saving) return;
    setSaving(true);
    try {
      await onPatch(room, {
        name: name.trim(),
        capacity: parsedCapacity.value,
        description: description.trim(),
        color,
        openBooking,
      });
      setOpen(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <li className="rounded-lg bg-stone-50 dark:bg-stone-800">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2">
        <div className="flex shrink-0">
          <IconButton
            onClick={() => void onMove(index, -1)}
            disabled={index === 0 || reordering}
            aria-label={`Move ${room.name} up`}
          >
            ↑
          </IconButton>
          <IconButton
            onClick={() => void onMove(index, 1)}
            disabled={index === total - 1 || reordering}
            aria-label={`Move ${room.name} down`}
          >
            ↓
          </IconButton>
        </div>

        <span
          aria-hidden
          className="h-5 w-5 shrink-0 rounded-full border border-stone-300 dark:border-stone-600"
          style={{ background: room.color }}
        />

        <div className="min-w-32 flex-1">
          <p className="truncate text-sm font-medium">{room.name}</p>
          <p className="truncate text-xs text-stone-500 dark:text-stone-400">
            {room.openBooking && (
              <span className="font-medium text-stone-600 dark:text-stone-300">
                Attendees may book this room ·{" "}
              </span>
            )}
            {capacityLabel(room.capacity)}
            {room.description && ` · ${room.description}`}
          </p>
        </div>

        <SecondaryButton
          className="shrink-0 px-3 py-1.5"
          onClick={() => {
            if (open) reset();
            setOpen(!open);
          }}
          aria-expanded={open}
        >
          {open ? "Close" : "Edit"}
        </SecondaryButton>
      </div>

      {open && (
        <div className="border-t border-stone-200 px-3 py-3 dark:border-stone-700">
          <FormStack>
            <FormGrid>
              <Field label="Room name">
                <ControlShell>
                  <TextInput
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    maxLength={80}
                  />
                </ControlShell>
              </Field>
              <NumberField
                label="Capacity"
                hint="Leave blank if it does not matter."
                spec={capacityField}
                value={capacity}
                onChange={setCapacity}
                className="w-20"
              />
            </FormGrid>

            <Field
              label="Description"
              hint="Shown to attendees. Where it is, how to find it."
            >
              <TextArea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                maxLength={500}
                className="resize-none"
              />
            </Field>

            <ColorPicker
              value={color}
              onChange={setColor}
              palette={ROOM_COLORS}
              label="Room colour"
            />

            <Toggle
              checked={openBooking}
              onChange={setOpenBooking}
              label="Attendees may book this room"
            />

            <FormRow className="mt-1">
              <PrimaryButton
                onClick={() => void save()}
                disabled={!dirty || !name.trim() || parsedCapacity.error !== null || saving}
              >
                {saving ? "Saving…" : "Save room"}
              </PrimaryButton>
              <SecondaryButton
                onClick={() => {
                  reset();
                  setOpen(false);
                }}
              >
                Cancel
              </SecondaryButton>
              <DangerButton
                className="ms-auto"
                onClick={() => void onDelete(room)}
              >
                Delete
              </DangerButton>
            </FormRow>
          </FormStack>
        </div>
      )}
    </li>
  );
}

/** Rooms — create, edit, reorder, delete. */
export function AdminRooms({
  rooms,
  reordering,
  onCreate,
  onPatch,
  onMove,
  onDelete,
}: AdminRoomsProps) {
  const [name, setName] = useState("");
  const [capacity, setCapacity] = useState("");
  // Most rooms never get one, so the field is asked for rather than always sat
  // there taking width off the name.
  const [capacityOpen, setCapacityOpen] = useState(false);
  const [openBooking, setOpenBooking] = useState(false);
  const [busy, setBusy] = useState(false);

  const parsedCapacity = parseCapacity(capacity);

  const add = async () => {
    if (!name.trim() || parsedCapacity.error || busy) return;
    setBusy(true);
    try {
      await onCreate({
        name: name.trim(),
        capacity: parsedCapacity.value,
        description: "",
        openBooking,
      });
      setName("");
      setCapacity("");
      setCapacityOpen(false);
      setOpenBooking(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section
      title="Rooms"
      description="Where sessions happen. Their order is the order of the schedule's columns."
      className="mb-6"
    >
      <ul className="mb-4 space-y-2">
        {rooms.map((room, index) => (
          <RoomRow
            key={room.id}
            room={room}
            index={index}
            total={rooms.length}
            reordering={reordering}
            onPatch={onPatch}
            onMove={onMove}
            onDelete={onDelete}
          />
        ))}
        {rooms.length === 0 && (
          <li className="text-sm text-stone-400 dark:text-stone-500">
            No rooms yet.
          </li>
        )}
      </ul>

      {/* One line on a desktop, wrapping on a phone. `items-end` is doing the
          alignment, so nothing here carries a nudged margin — which is why the
          capacity field has no hint: a hint would make it taller than the name
          and lift the buttons off the baseline. */}
      <InlineForm onSubmit={() => void add()}>
        <FormRow>
          <div className="min-w-40 flex-1">
            <Field label="New room">
              <ControlShell>
                <TextInput
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={80}
                />
              </ControlShell>
            </Field>
          </div>

          {capacityOpen ? (
            <NumberField
              label="Capacity"
              spec={capacityField}
              value={capacity}
              onChange={setCapacity}
              className="w-20"
              autoFocus
            />
          ) : (
            <SecondaryButton onClick={() => setCapacityOpen(true)}>
              Specify capacity
            </SecondaryButton>
          )}

          <PrimaryButton
            type="submit"
            disabled={!name.trim() || parsedCapacity.error !== null || busy}
          >
            Add room
          </PrimaryButton>
        </FormRow>

        {/* Sits against the name field it qualifies, not floating in the gap
            between two form rows. */}
        <div className="mt-1.5">
          <Toggle
            checked={openBooking}
            onChange={setOpenBooking}
            label="Attendees may book this room"
          />
        </div>
      </InlineForm>
    </Section>
  );
}
