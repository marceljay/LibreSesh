import { createHash, randomInt } from 'node:crypto';
import { atLeast } from './auth.js';
import type { Db, IdentityRow, PersonRow } from './db.js';
import { claimEventName, eventDisplayName } from './eventIdentity.js';
import { newIdentityToken, newPublicId } from './identity.js';

/**
 * Link phrases: `pine-otter-lantern`. Three words beat a hex code because a
 * phrase survives being read across a room or typed on a phone keyboard.
 * ~500 words × 3 gives about 27 bits — nowhere near password strength, and it
 * does not need to be: a code is single use, dies after ten minutes, and
 * guesses burn the same rate-limit budget as password attempts.
 */
export const LINK_CODE_TTL_MS = 10 * 60_000;

// Short, concrete, unambiguous words. No plurals-of-other-entries, no
// homophones of each other, nothing rude. Order is irrelevant.
export const WORDS: readonly string[] = [
  'acorn',
  'alarm',
  'amber',
  'anchor',
  'angle',
  'ankle',
  'antler',
  'apple',
  'apron',
  'arrow',
  'atlas',
  'attic',
  'autumn',
  'avenue',
  'awning',
  'badge',
  'bagel',
  'bamboo',
  'banjo',
  'barley',
  'barn',
  'basil',
  'basket',
  'beach',
  'beacon',
  'beak',
  'beam',
  'bean',
  'beard',
  'beaver',
  'bell',
  'belt',
  'bench',
  'berry',
  'bicycle',
  'birch',
  'bison',
  'blanket',
  'blossom',
  'boat',
  'bolt',
  'bonfire',
  'book',
  'boot',
  'border',
  'bottle',
  'boulder',
  'bow',
  'bowl',
  'box',
  'branch',
  'brass',
  'bread',
  'breeze',
  'brick',
  'bridge',
  'broom',
  'brush',
  'bucket',
  'budgie',
  'bugle',
  'bunker',
  'burrow',
  'bus',
  'butter',
  'button',
  'cabin',
  'cable',
  'cactus',
  'camel',
  'camera',
  'canal',
  'candle',
  'canoe',
  'canyon',
  'carpet',
  'carrot',
  'castle',
  'cattle',
  'cedar',
  'cellar',
  'chair',
  'chalk',
  'cheese',
  'cherry',
  'chess',
  'chest',
  'chimney',
  'chisel',
  'cider',
  'cinema',
  'circle',
  'circus',
  'clam',
  'clay',
  'cliff',
  'clock',
  'cloud',
  'clover',
  'coal',
  'coast',
  'cobalt',
  'coconut',
  'coffee',
  'coin',
  'collar',
  'comet',
  'compass',
  'copper',
  'coral',
  'cork',
  'corn',
  'cotton',
  'cougar',
  'cradle',
  'crane',
  'crater',
  'crayon',
  'cricket',
  'crow',
  'crumb',
  'crystal',
  'curtain',
  'cushion',
  'cyclone',
  'daisy',
  'deck',
  'deer',
  'delta',
  'desert',
  'desk',
  'dew',
  'diamond',
  'dice',
  'dinghy',
  'dome',
  'donkey',
  'door',
  'dough',
  'dragon',
  'drawer',
  'drill',
  'drum',
  'duck',
  'dune',
  'dusk',
  'eagle',
  'earth',
  'easel',
  'echo',
  'eel',
  'elbow',
  'elder',
  'elm',
  'ember',
  'engine',
  'envelope',
  'ermine',
  'falcon',
  'fern',
  'ferry',
  'fiddle',
  'field',
  'fig',
  'finch',
  'fjord',
  'flag',
  'flame',
  'flask',
  'fleece',
  'flint',
  'flute',
  'fog',
  'forest',
  'fork',
  'fossil',
  'fox',
  'frame',
  'frost',
  'fudge',
  'funnel',
  'galaxy',
  'garden',
  'garlic',
  'gate',
  'gecko',
  'geyser',
  'ginger',
  'glacier',
  'glade',
  'glass',
  'glove',
  'goat',
  'goggles',
  'gold',
  'gong',
  'goose',
  'gorge',
  'granite',
  'grape',
  'grass',
  'gravel',
  'grove',
  'guitar',
  'gull',
  'hammer',
  'hammock',
  'harbor',
  'harp',
  'harvest',
  'hatch',
  'hawk',
  'hazel',
  'heron',
  'hill',
  'hinge',
  'hive',
  'holly',
  'honey',
  'hood',
  'hoof',
  'hook',
  'horizon',
  'horn',
  'horse',
  'hound',
  'house',
  'hut',
  'iceberg',
  'igloo',
  'ink',
  'iron',
  'island',
  'ivory',
  'ivy',
  'jacket',
  'jade',
  'jaguar',
  'jar',
  'jelly',
  'jigsaw',
  'jungle',
  'juniper',
  'kayak',
  'kettle',
  'key',
  'kiln',
  'kite',
  'kiwi',
  'knot',
  'ladder',
  'ladle',
  'lagoon',
  'lake',
  'lamp',
  'lantern',
  'lark',
  'laser',
  'lava',
  'lawn',
  'leaf',
  'ledge',
  'lemon',
  'lens',
  'lentil',
  'leopard',
  'lever',
  'lichen',
  'lighthouse',
  'lily',
  'lime',
  'linen',
  'lion',
  'lizard',
  'llama',
  'lobster',
  'lock',
  'log',
  'loom',
  'lotus',
  'lynx',
  'magnet',
  'mango',
  'mantis',
  'maple',
  'marble',
  'market',
  'marsh',
  'mask',
  'mast',
  'meadow',
  'melon',
  'mesa',
  'meteor',
  'mill',
  'mint',
  'mirror',
  'mitten',
  'moat',
  'mole',
  'monsoon',
  'moose',
  'mosaic',
  'moss',
  'moth',
  'motor',
  'mountain',
  'mouse',
  'mug',
  'mule',
  'mural',
  'mushroom',
  'nail',
  'napkin',
  'nectar',
  'needle',
  'nest',
  'net',
  'newt',
  'north',
  'nutmeg',
  'oak',
  'oar',
  'oasis',
  'ocean',
  'olive',
  'onion',
  'opal',
  'orbit',
  'orchard',
  'organ',
  'oriole',
  'otter',
  'oven',
  'owl',
  'ox',
  'oyster',
  'paddle',
  'pail',
  'palm',
  'panda',
  'pantry',
  'paper',
  'parcel',
  'parrot',
  'pasta',
  'patch',
  'path',
  'peach',
  'peacock',
  'pearl',
  'pebble',
  'pecan',
  'pedal',
  'pelican',
  'pencil',
  'penguin',
  'peony',
  'pepper',
  'perch',
  'petal',
  'piano',
  'pickle',
  'picnic',
  'pier',
  'pigeon',
  'pillow',
  'pilot',
  'pine',
  'pistachio',
  'pitcher',
  'planet',
  'plank',
  'plaza',
  'plow',
  'plum',
  'pocket',
  'polar',
  'pond',
  'pony',
  'poplar',
  'poppy',
  'porch',
  'portrait',
  'poster',
  'potato',
  'prairie',
  'prism',
  'pretzel',
  'pulley',
  'pumpkin',
  'puppet',
  'pyramid',
  'quail',
  'quarry',
  'quartz',
  'quill',
  'quilt',
  'rabbit',
  'raccoon',
  'radio',
  'radish',
  'raft',
  'rail',
  'rain',
  'rake',
  'ranch',
  'raven',
  'reef',
  'reel',
  'ribbon',
  'rice',
  'ridge',
  'river',
  'roast',
  'robin',
  'rocket',
  'roof',
  'rope',
  'rose',
  'rowboat',
  'ruby',
  'rudder',
  'rug',
  'runway',
  'saddle',
  'saffron',
  'sage',
  'sail',
  'salad',
  'salmon',
  'sand',
  'sapphire',
  'satchel',
  'saucer',
  'sauna',
  'saw',
  'scarf',
  'school',
  'scooter',
  'seal',
  'seed',
  'shadow',
  'shark',
  'shed',
  'shelf',
  'shell',
  'shield',
  'ship',
  'shore',
  'shovel',
  'shrimp',
  'shutter',
  'silk',
  'silver',
  'sketch',
  'ski',
  'sled',
  'sleet',
  'slipper',
  'sloth',
  'smoke',
  'snail',
  'snow',
  'sock',
  'sofa',
  'soil',
  'sonar',
  'spade',
  'spark',
  'sparrow',
  'spice',
  'spider',
  'spinach',
  'spiral',
  'sponge',
  'spool',
  'spoon',
  'spring',
  'spruce',
  'squash',
  'squirrel',
  'stable',
  'stack',
  'stadium',
  'stamp',
  'star',
  'statue',
  'steam',
  'steel',
  'stem',
  'stone',
  'stool',
  'stork',
  'storm',
  'stove',
  'straw',
  'stream',
  'street',
  'string',
  'summit',
  'sun',
  'swan',
  'sweater',
  'swing',
  'syrup',
  'table',
  'tailor',
  'tandem',
  'tangerine',
  'tea',
  'teapot',
  'telescope',
  'tent',
  'thistle',
  'thread',
  'thunder',
  'ticket',
  'tiger',
  'timber',
  'toad',
  'toast',
  'tomato',
  'torch',
  'tortoise',
  'tower',
  'tractor',
  'trail',
  'train',
  'tram',
  'treasure',
  'tree',
  'trellis',
  'trench',
  'tripod',
  'trout',
  'trumpet',
  'trunk',
  'tulip',
  'tundra',
  'tunnel',
  'turbine',
  'turnip',
  'turtle',
  'tusk',
  'twig',
  'umbrella',
  'valley',
  'vanilla',
  'vase',
  'vault',
  'velvet',
  'vine',
  'violet',
  'violin',
  'volcano',
  'wagon',
  'walnut',
  'walrus',
  'wand',
  'wasp',
  'watch',
  'water',
  'wave',
  'weasel',
  'well',
  'whale',
  'wharf',
  'wheat',
  'wheel',
  'whisk',
  'willow',
  'wind',
  'window',
  'wing',
  'winter',
  'wolf',
  'wombat',
  'wood',
  'wool',
  'wren',
  'yacht',
  'yarn',
  'yeast',
  'yogurt',
  'zebra',
  'zephyr',
  'zinc',
];

export const newLinkPhrase = (): string =>
  Array.from({ length: 3 }, () => WORDS[randomInt(WORDS.length)]).join('-');

/** Case, spacing and separator don't matter: "House Dog  erratic" redeems `house-dog-erratic`. */
export const normalizePhrase = (raw: string): string =>
  raw
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .join('-');

export const hashPhrase = (raw: string): string =>
  createHash('sha256').update(normalizePhrase(raw)).digest('hex');

/**
 * Mint a fresh phrase for this identity, replacing any it already had — one
 * live code per identity keeps "did my old code die?" a non-question.
 */
export function mintLinkCode(db: Db, identityId: number): { phrase: string; expiresAt: string } {
  const now = Date.now();
  const expiresAt = new Date(now + LINK_CODE_TTL_MS).toISOString();
  const phrase = db.transaction(() => {
    // Only this identity's *device* phrase — a speaker code minted against
    // the same identity must survive.
    db.prepare('DELETE FROM link_codes WHERE identity_id = ? AND person_id IS NULL').run(
      identityId,
    );
    // The hash is UNIQUE across identities; on the off-chance of a collision
    // just roll again.
    for (;;) {
      const candidate = newLinkPhrase();
      try {
        db.prepare(
          'INSERT INTO link_codes (identity_id, code_hash, created_at, expires_at) VALUES (?, ?, ?, ?)',
        ).run(identityId, hashPhrase(candidate), new Date(now).toISOString(), expiresAt);
        return candidate;
      } catch (err) {
        if (!String(err).includes('UNIQUE')) throw err;
      }
    }
  })();
  return { phrase, expiresAt };
}

/**
 * Redeem a phrase and hand back the identity it belongs to. The caller sets
 * that identity's token as the requester's cookie — adoption, not merging.
 * A device phrase burns on first use; a speaker code (`person_id` set) is
 * reusable until revoked, `used_at` just recording the last redemption.
 * Undefined means wrong, expired, used up, or revoked.
 */
export function redeemLinkCode(db: Db, rawPhrase: string): IdentityRow | undefined {
  return db.transaction((): IdentityRow | undefined => {
    const row = db
      .prepare<[string, string], { id: number; identity_id: number }>(
        `SELECT id, identity_id FROM link_codes
          WHERE code_hash = ?
            AND (expires_at IS NULL OR expires_at > ?)
            AND (used_at IS NULL OR person_id IS NOT NULL)
            -- A speaker code dies with the profile it stands for. The routes
            -- that remove a profile revoke it outright; this is the backstop
            -- for a row that predates them, or a future path that soft-deletes
            -- a person and forgets. Device phrases (person_id NULL) are
            -- unaffected.
            AND (
              person_id IS NULL
              OR EXISTS (
                SELECT 1 FROM people p
                 WHERE p.id = link_codes.person_id AND p.deleted_at IS NULL
              )
            )`,
      )
      .get(hashPhrase(rawPhrase), new Date().toISOString());
    if (!row) return undefined;
    db.prepare('UPDATE link_codes SET used_at = ? WHERE id = ?').run(
      new Date().toISOString(),
      row.id,
    );
    return db
      .prepare<[number], IdentityRow>('SELECT * FROM identities WHERE id = ?')
      .get(row.identity_id);
  })();
}

/** Four words, not three: a speaker code lives until revoked. ~37 bits. */
export const newSpeakerPhrase = (): string =>
  Array.from({ length: 4 }, () => WORDS[randomInt(WORDS.length)]).join('-');

/**
 * Mint (or replace) the speaker code for one person. Everything identity-
 * shaped happens here, at mint time, in the organiser's request — so
 * redemption stays the dumb adoption `/me/link` already does:
 *
 * - an unclaimed person gets a fresh identity attached (nobody's cookie
 *   points at it until the code is redeemed);
 * - that identity is raised to the speaker role in this event, never
 *   downgraded (an organiser who is also a speaker stays an organiser);
 * - it claims the person's name at this event, suffixed on a collision the
 *   same way migration 009 resolved them.
 */
export function mintSpeakerCode(db: Db, eventId: number, person: PersonRow): { phrase: string } {
  const now = new Date().toISOString();
  const phrase = db.transaction(() => {
    let identityId = person.identity_id;
    if (identityId === null) {
      identityId = Number(
        db
          .prepare(
            'INSERT INTO identities (public_id, token, display_name, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?)',
          )
          .run(newPublicId(db), newIdentityToken(), person.name, now, now).lastInsertRowid,
      );
      db.prepare('UPDATE people SET identity_id = ? WHERE id = ?').run(identityId, person.id);
    }

    const held = db
      .prepare<[number, number], { role: 'viewer' | 'user' | 'speaker' | 'admin' }>(
        'SELECT role FROM roles WHERE identity_id = ? AND event_id = ?',
      )
      .get(identityId, eventId);
    if (!held || !atLeast(held.role, 'speaker')) {
      db.prepare(
        `INSERT INTO roles (identity_id, event_id, role, granted_at) VALUES (?, ?, 'speaker', ?)
         ON CONFLICT(identity_id, event_id) DO UPDATE SET role = excluded.role, granted_at = excluded.granted_at`,
      ).run(identityId, eventId, now);
    }

    if (!eventDisplayName(db, eventId, identityId)) {
      const base = person.name.slice(0, 40);
      try {
        claimEventName(db, eventId, identityId, base);
      } catch {
        const suffix = ` #${identityId}`;
        claimEventName(db, eventId, identityId, base.slice(0, 40 - suffix.length) + suffix);
      }
    }

    db.prepare('DELETE FROM link_codes WHERE person_id = ?').run(person.id);
    for (;;) {
      const candidate = newSpeakerPhrase();
      try {
        db.prepare(
          `INSERT INTO link_codes (identity_id, person_id, code_hash, created_at, expires_at)
           VALUES (?, ?, ?, ?, NULL)`,
        ).run(identityId, person.id, hashPhrase(candidate), now);
        return candidate;
      } catch (err) {
        if (!String(err).includes('UNIQUE')) throw err;
      }
    }
  })();
  return { phrase };
}

/** Revoke a person's speaker code. Devices already linked keep the identity —
 *  an organiser who wants them out changes the role, not the code. */
export function revokeSpeakerCode(db: Db, personId: number): void {
  db.prepare('DELETE FROM link_codes WHERE person_id = ?').run(personId);
}

/**
 * Settle the loser's speaker code when two profiles are merged.
 *
 * A code grants an *identity*, and merging decides which identity the surviving
 * profile carries. So the question is not "was this the survivor's code" but
 * "does this code still hand out the person who is left":
 *
 * - it does, when the survivor had no identity of its own and inherited the
 *   loser's — the phrase an organiser already emailed to that speaker still
 *   names them, so it follows the profile rather than being cancelled;
 * - it does not, when the survivor kept its own identity. The loser's identity
 *   is abandoned by the merge but keeps its `speaker` role, so leaving the code
 *   alive would let anyone who types it walk in as a profile that is no longer
 *   on the roster — and no organiser could take it back, because revoking loads
 *   the person and a soft-deleted one is a 404.
 *
 * Called inside the merge transaction, after the loser is soft-deleted.
 */
export function settleSpeakerCodeAfterMerge(
  db: Db,
  loserId: number,
  survivorId: number,
  survivingIdentityId: number | null,
): void {
  const code = db
    .prepare<[number], { id: number; identity_id: number }>(
      'SELECT id, identity_id FROM link_codes WHERE person_id = ?',
    )
    .get(loserId);
  if (!code) return;

  // `link_codes.person_id` is unique where set, so the survivor's own code —
  // if it has one — wins and the loser's goes.
  const survivorHasOne = db
    .prepare<[number], { id: number }>('SELECT id FROM link_codes WHERE person_id = ?')
    .get(survivorId);

  if (code.identity_id === survivingIdentityId && !survivorHasOne) {
    db.prepare('UPDATE link_codes SET person_id = ? WHERE id = ?').run(survivorId, code.id);
    return;
  }
  db.prepare('DELETE FROM link_codes WHERE id = ?').run(code.id);
}
