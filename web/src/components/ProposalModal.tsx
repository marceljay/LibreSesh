import { useState } from 'react';
import type { PersonDto, ProposalDto, Role, TagDto } from '@shared/types';
import type { ProposalWrite } from '../lib/api';
import { SpeakerCombobox, type SpeakerChoice } from './SpeakerCombobox';
import {
  Chip,
  ControlShell,
  DangerButton,
  Field,
  FormError,
  FormStack,
  Modal,
  PrimaryButton,
  SecondaryButton,
  TextArea,
  TextInput,
} from './ui';

export interface ProposalModalProps {
  proposal?: ProposalDto;
  people: PersonDto[];
  role: Role;
  /** `session.credit_others` for this role — see SessionModal. */
  canCreditOthers: boolean;
  tags: TagDto[];
  saving: boolean;
  onCancel: () => void;
  onSave: (body: ProposalWrite) => void;
  onDelete?: () => void;
}

/** Pitch a session with no room or time yet — mirrors SessionModal's
 *  select-or-new speaker pattern (SPEC §8). */
export function ProposalModal({
  proposal,
  people,
  role,
  canCreditOthers,
  tags,
  saving,
  onCancel,
  onSave,
  onDelete,
}: ProposalModalProps) {
  const [title, setTitle] = useState(proposal?.title ?? '');
  const [description, setDescription] = useState(proposal?.description ?? '');
  // A pitch is by one person, so this is a list of at most one — the control
  // is shared with the session form, which takes as many as are giving it.
  // A new pitch by anyone but an organiser starts as their own: a pitch is
  // "I would give this", and it is one click to say otherwise.
  const isAdmin = role === 'admin';
  const [speaker, setSpeaker] = useState<SpeakerChoice[]>(() => {
    if (proposal) return proposal.speakerId === null ? [] : [proposal.speakerId];
    const mine = people.find((p) => p.isMine);
    return !isAdmin && mine ? [mine.id] : [];
  });
  const [tagIds, setTagIds] = useState<number[]>(proposal?.tagIds ?? []);
  const [error, setError] = useState<string | null>(null);

  const save = () => {
    if (!title.trim()) {
      setError('A title is required');
      return;
    }
    onSave({
      title: title.trim(),
      description: description.trim(),
      ...(speaker.length === 0
        ? { speakerId: null }
        : typeof speaker[0] === 'number'
          ? { speakerId: speaker[0] }
          : { speakerName: speaker[0] }),
      tagIds,
    });
  };

  return (
    <Modal
      title={proposal ? 'Edit pitch' : 'Pitch a session'}
      description="Pitches have no room or time. An organiser places the popular ones on the grid."
      onClose={onCancel}
      onSubmit={save}
      footer={
        <>
          {error && <FormError className="basis-full">{error}</FormError>}
          {onDelete && (
            <DangerButton className="mr-auto" onClick={onDelete}>
              Withdraw
            </DangerButton>
          )}
          <SecondaryButton onClick={onCancel}>Cancel</SecondaryButton>
          <PrimaryButton type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </PrimaryButton>
        </>
      }
    >
      <FormStack>
      <Field label="Title">
        <ControlShell>
          <TextInput
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={120}
            autoFocus
          />
        </ControlShell>
      </Field>
      <Field label="Speaker or host">
        <SpeakerCombobox
          people={people}
          value={speaker}
          onChange={setSpeaker}
          max={1}
          isAdmin={isAdmin}
          onlySelf={!isAdmin && !canCreditOthers}
        />
      </Field>
      <Field label="Description" hint="Markdown is supported.">
        <TextArea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          maxLength={5000}
          className="resize-none"
        />
      </Field>

      <Field label="Tags">
        <div className="flex flex-wrap gap-1.5">
          {tags.length === 0 && (
            <span className="text-xs text-stone-400 dark:text-stone-500">No tags yet.</span>
          )}
          {tags.map((t) => (
            <Chip
              key={t.id}
              dot={t.color}
              active={tagIds.includes(t.id)}
              onClick={() =>
                setTagIds((prev) =>
                  prev.includes(t.id) ? prev.filter((x) => x !== t.id) : [...prev, t.id],
                )
              }
            >
              {t.name}
            </Chip>
          ))}
        </div>
      </Field>
      </FormStack>
    </Modal>
  );
}
