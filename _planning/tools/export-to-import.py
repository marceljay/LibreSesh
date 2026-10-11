#!/usr/bin/env python3
"""Convert a `libresesh.event` EXPORT into a document the IMPORTER accepts.

They are two different formats. The export is a data dump keyed by id; the
importer takes the authoring document, which refers to rooms/tracks/tags by
name and states break and track hours as HH:MM.
"""
import json, sys

def hhmm(m):
    return None if m is None else f"{m // 60:02d}:{m % 60:02d}"

def nonempty(d, *keys):
    """Drop empty strings and nulls — the importer's optional fields would
    reject '' where it happily accepts the key being absent."""
    return {k: v for k, v in d.items() if k in keys and v not in ('', None)}

src = json.load(open(sys.argv[1], encoding='utf8'))
ev = src['event']

room_name  = {r['id']: r['name'] for r in src.get('rooms',  [])}
track_name = {t['id']: t['name'] for t in src.get('tracks', [])}
tag_name   = {t['id']: t['name'] for t in src.get('tags',   [])}

out = {'format': 'libresesh.event', 'version': 1}

# Only the keys the importer's event schema knows. weekRailFrom, archived and
# createdAt are export-only and the top level is .strict().
out['event'] = {k: ev[k] for k in
                ('name','slug','timezone','startDate','endDate',
                 'dayStartMin','dayEndMin','userRoleLabel','defaultView')
                if k in ev and ev[k] is not None}

# Array order is column order, so sortOrder is carried by position, not a field.
out['rooms'] = [
    {'name': r['name'],
     **nonempty(r, 'description', 'color'),
     **({'capacity': r['capacity']} if r.get('capacity') is not None else {}),
     'openBooking': r.get('openBooking', True)}
    for r in sorted(src.get('rooms', []), key=lambda r: r.get('sortOrder', 0))
]

tracks = []
for t in sorted(src.get('tracks', []), key=lambda t: t.get('sortOrder', 0)):
    row = {'name': t['name'], **nonempty(t, 'description', 'color')}
    if t.get('startMin') is not None and t.get('endMin') is not None:
        row['start'], row['end'] = hhmm(t['startMin']), hhmm(t['endMin'])
    if t.get('windows'):
        row['windows'] = [{'date': w['date'],
                           'start': hhmm(w['startMin']),
                           'end':   hhmm(w['endMin'])} for w in t['windows']]
    tracks.append(row)
if tracks:
    out['tracks'] = tracks

if src.get('tags'):
    out['tags'] = [{'name': t['name'], **nonempty(t, 'color')} for t in src['tags']]

# The reported failure: export writes startMin/endMin, the importer wants HH:MM.
if src.get('breaks'):
    out['breaks'] = [
        {'label': b['label'], 'start': hhmm(b['startMin']), 'end': hhmm(b['endMin']),
         **({'date': b['date']} if b.get('date') else {})}
        for b in src['breaks']
    ]

sessions = []
for s in src.get('sessions', []):
    row = {'room': room_name[s['roomId']], 'title': s['title'],
           'startsAt': s['startsAt'], 'endsAt': s['endsAt']}
    if s.get('trackId') is not None:
        row['track'] = track_name[s['trackId']]
    if s.get('tagIds'):
        row['tags'] = [tag_name[i] for i in s['tagIds']]
    if s.get('speakers'):
        row['speakers'] = s['speakers']
    elif s.get('speaker'):
        row['speaker'] = s['speaker']
    row.update(nonempty(s, 'description', 'livestreamUrl'))
    if s.get('type'):
        row['type'] = s['type']
    if s.get('blocksOpenBooking') is not None:
        row['blocksOpenBooking'] = s['blocksOpenBooking']
    sessions.append(row)
if sessions:
    out['sessions'] = sessions

json.dump(out, open(sys.argv[2], 'w', encoding='utf8'), ensure_ascii=False, indent=2)

dropped = [k for k in ('people','proposals','contributions','exportedAt') if src.get(k)]
print(f"wrote {sys.argv[2]}")
print(f"  rooms={len(out.get('rooms',[]))} tracks={len(out.get('tracks',[]))} "
      f"tags={len(out.get('tags',[]))} breaks={len(out.get('breaks',[]))} "
      f"sessions={len(out.get('sessions',[]))}")
print(f"  NOT carried over (the importer has no field for them): {', '.join(dropped) or 'none'}")
