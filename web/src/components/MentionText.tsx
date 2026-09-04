import { Fragment } from 'react';
import { Link } from 'react-router-dom';
import type { PersonDto } from '@shared/types';
import { tokenizeMentions } from '@shared/mentions';

/** Whoever goes by this username in the event, if anyone. Usernames are unique
 *  per event (migration 009), so a match is the one person and nothing else. */
export function personByUsername(
  people: PersonDto[],
  username: string,
): PersonDto | undefined {
  const wanted = username.toLowerCase();
  return people.find((p) => p.username !== null && p.username.toLowerCase() === wanted);
}

/** A name that links to its profile when the event knows it, and is plain text
 *  otherwise — an author whose name fell back to a UID has no profile to open. */
export function PersonLink({
  slug,
  person,
  children,
  className = 'font-medium text-stone-500 hover:underline dark:text-stone-400',
}: {
  slug: string;
  person: PersonDto | undefined;
  children: React.ReactNode;
  className?: string;
}) {
  if (!person) return <>{children}</>;
  return (
    <Link to={`/e/${slug}/p/${person.id}`} className={className}>
      {children}
    </Link>
  );
}

/**
 * A comment body with `@username` mentions turned into profile links. The parse
 * is the shared tokenizer, so what counts as a mention here is exactly what will
 * count on the server when notifications land — see
 * `_planning/specs/mentions-and-notifications.md`.
 */
export function MentionText({
  slug,
  people,
  text,
}: {
  slug: string;
  people: PersonDto[];
  text: string;
}) {
  const usernames = people
    .map((p) => p.username)
    .filter((u): u is string => u !== null);
  const segments = tokenizeMentions(text, usernames);

  return (
    <>
      {segments.map((seg, i) =>
        seg.type === 'mention' ? (
          <PersonLink
            key={i}
            slug={slug}
            person={personByUsername(people, seg.name)}
            className="font-medium text-blue-700 hover:underline dark:text-blue-400"
          >
            @{seg.name}
          </PersonLink>
        ) : (
          <Fragment key={i}>{seg.text}</Fragment>
        ),
      )}
    </>
  );
}
