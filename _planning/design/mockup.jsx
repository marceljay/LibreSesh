import React, { useEffect, useMemo, useRef, useState } from "react";

/* ------------------------------------------------------------------ */
/* OpenGrid — clickable mockup. Fake data, in-memory state only.       */
/* Passwords: viewer2026 / user2026 / admin2026                        */
/* ------------------------------------------------------------------ */

const PX_PER_MIN = 1.6;
const DAY_START = 8 * 60; // 08:00
const DAY_END = 22 * 60; // 22:00
const COL_W = 176;
const SNAP = 5;

const ACCENT = "#FFD84D"; // highlighter yellow — now-line signature

const ROOMS = [
  { id: 1, name: "Main Hall", capacity: 300, open: false },
  { id: 2, name: "Workshop A", capacity: 60, open: false },
  { id: 3, name: "Workshop B", capacity: 60, open: false },
  { id: 4, name: "Open Track", capacity: 40, open: true },
];

const TAGS = [
  { id: 1, name: "AI", color: "#7C6FF0" },
  { id: 2, name: "Community", color: "#3AA981" },
  { id: 3, name: "Web", color: "#E2703A" },
  { id: 4, name: "Hardware", color: "#4A90D9" },
  { id: 5, name: "Beginner", color: "#C25FA3" },
];

const pad = (n) => String(n).padStart(2, "0");
const fmtMin = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
const snap = (m) => Math.round(m / SNAP) * SNAP;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function dayLabel(idx) {
  const d = new Date();
  d.setDate(d.getDate() + idx);
  const wd = d.toLocaleDateString(undefined, { weekday: "short" });
  const md = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return { top: idx === 0 ? "Today" : idx === 1 ? "Tomorrow" : wd, sub: md };
}

let idc = 100;
const S = (day, room, start, dur, title, speaker, tagIds, type = "official", createdBy = "sys", desc = "") => ({
  id: idc++, day, roomId: room, startMin: start, durMin: dur, title, speaker,
  tagIds, type, createdBy, desc,
});

const INITIAL_SESSIONS = [
  S(0, 1, 540, 45, "Opening & orientation", "Org team", [2], "official", "sys",
    "Welcome, house rules, how open tracks work, and how to propose a session."),
  S(0, 1, 600, 60, "Keynote: Small tools, big rooms", "Ada Osei", [1, 2], "official", "sys",
    "Why lightweight, disposable software wins at community events."),
  S(0, 1, 780, 60, "Panel: Funding community infra", "4 guests", [2]),
  S(0, 1, 960, 60, "Lightning talks", "Anyone (signup at desk)", [2, 5]),
  S(0, 2, 600, 90, "Workshop: Local-first apps", "J. Park", [3, 1], "official", "sys",
    "Hands-on: build a sync-free app with SQLite and SSE. Bring a laptop."),
  S(0, 2, 750, 60, "Intro to soldering", "M. Rivera", [4, 5]),
  S(0, 2, 900, 90, "Accessibility clinic", "T. Nkemelu", [3]),
  S(0, 3, 570, 60, "Docs that people read", "S. Lindqvist", [2]),
  S(0, 3, 690, 90, "LLM eval hack session", "P. Chen", [1]),
  S(0, 3, 840, 60, "Static sites in 2026", "R. Adeyemi", [3, 5]),
  S(0, 4, 660, 30, "Zine swap & chat", "anon_h3lio", [2], "open", "peer"),
  S(0, 4, 720, 45, "Show your homelab", "anon_qq2z8", [4], "open", "peer",
    "Bring photos or the real thing. Informal show and tell."),
  S(0, 4, 810, 30, "Mesh networking Q&A", "anon_x7k2f", [4], "open", "me"),
  S(1, 1, 570, 60, "Keynote: The unconference pattern", "N. Haddad", [2]),
  S(1, 2, 600, 120, "Workshop: Sensors & soil", "GreenLab", [4]),
  S(1, 3, 660, 60, "Careers AMA", "Volunteers", [2, 5]),
  S(1, 4, 630, 45, "Board game design jam", "anon_v1ola", [2], "open", "peer"),
];

const INITIAL_CONTRIBS = [
  { id: 1, sessionId: 101, kind: "link", body: "Slides", url: "https://example.com/keynote", author: "Ada Osei", mins: 20 },
  { id: 2, sessionId: 101, kind: "question", body: "How do you decide when a tool should stay disposable vs. get maintained?", author: "anon_h3lio", mins: 14 },
  { id: 3, sessionId: 101, kind: "note", body: "Related: the 'situated software' essay.", author: "anon_qq2z8", mins: 9 },
  { id: 4, sessionId: 104, kind: "link", body: "Starter repo", url: "https://example.com/repo", author: "J. Park", mins: 55 },
  { id: 5, sessionId: 112, kind: "note", body: "I can bring a spare antenna.", author: "anon_v1ola", mins: 30 },
];

const KIND_META = {
  question: { label: "Questions", icon: "?" },
  note: { label: "Notes", icon: "≡" },
  link: { label: "Links", icon: "↗" },
};

/* ------------------------------ App ------------------------------ */

export default function App() {
  const [role, setRole] = useState(null); // null | viewer | user | admin
  const [name, setName] = useState("anon_x7k2f");
  const [sessions, setSessions] = useState(INITIAL_SESSIONS);
  const [contribs, setContribs] = useState(INITIAL_CONTRIBS);
  const [day, setDay] = useState(0);
  const [view, setView] = useState(typeof window !== "undefined" && window.innerWidth < 640 ? "list" : "cal");
  const [filters, setFilters] = useState({ rooms: [], tags: [], q: "" });
  const [selected, setSelected] = useState(null); // session id
  const [editing, setEditing] = useState(null); // {session?} for modal
  const [rolePanel, setRolePanel] = useState(false);
  const [arrange, setArrange] = useState(false);
  const [toast, setToast] = useState(null);
  const [nowMin, setNowMin] = useState(() => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); });

  useEffect(() => {
    const t = setInterval(() => { const d = new Date(); setNowMin(d.getHours() * 60 + d.getMinutes()); }, 30000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 2600); return () => clearTimeout(t); }, [toast]);

  const canWrite = role === "user" || role === "admin";
  const canEdit = (s) => role === "admin" || (role === "user" && s.type === "open" && s.createdBy === "me");

  const visible = useMemo(() => {
    const q = filters.q.trim().toLowerCase();
    return sessions.filter((s) =>
      s.day === day &&
      (filters.rooms.length === 0 || filters.rooms.includes(s.roomId)) &&
      (filters.tags.length === 0 || s.tagIds.some((t) => filters.tags.includes(t))) &&
      (!q || (s.title + " " + s.speaker + " " + s.desc).toLowerCase().includes(q))
    );
  }, [sessions, day, filters]);

  const anyFilter = filters.rooms.length || filters.tags.length || filters.q;

  const calRef = useRef(null);
  const jumpToNow = () => {
    setDay(0);
    setView((v) => v); // keep view
    requestAnimationFrame(() => {
      const el = calRef.current;
      if (el) el.scrollTo({ top: (nowMin - DAY_START) * PX_PER_MIN - el.clientHeight / 2, behavior: "smooth" });
      const list = document.getElementById("now-anchor");
      if (list) list.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  };

  const saveSession = (data, id) => {
    if (role !== "admin") {
      const room = ROOMS.find((r) => r.id === data.roomId);
      if (!room?.open) return setToast("Users can only schedule in open-track rooms");
      const overlap = sessions.some((s) => s.id !== id && s.day === data.day && s.roomId === data.roomId &&
        data.startMin < s.startMin + s.durMin && s.startMin < data.startMin + data.durMin);
      if (overlap) return setToast("That slot overlaps an existing session");
      data.type = "open";
    }
    if (id != null) {
      setSessions((ss) => ss.map((s) => (s.id === id ? { ...s, ...data } : s)));
      setToast("Session updated");
    } else {
      setSessions((ss) => [...ss, { ...data, id: idc++, createdBy: role === "admin" ? "sys" : "me" }]);
      setToast("Session added");
    }
    setEditing(null);
  };

  const deleteSession = (id) => {
    setSessions((ss) => ss.filter((s) => s.id !== id));
    setSelected(null); setEditing(null); setToast("Session deleted");
  };

  const moveSession = (id, startMin, roomId) => {
    setSessions((ss) => ss.map((s) => (s.id === id ? { ...s, startMin, roomId } : s)));
    setToast(`Moved to ${ROOMS.find((r) => r.id === roomId)?.name} · ${fmtMin(startMin)}`);
  };

  if (!role) return <Gate onEnter={(r) => setRole(r)} name={name} setName={setName} />;

  const selectedSession = sessions.find((s) => s.id === selected);

  return (
    <div className="min-h-screen bg-stone-100 text-stone-900" style={{ fontFamily: "ui-sans-serif, system-ui, sans-serif" }}>
      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-stone-200 bg-stone-50/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-stone-900 text-sm font-bold text-white">D</div>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold tracking-tight">DemoConf 2026</div>
            <div className="text-xs text-stone-500">Berlin · 2 days · schedule is live</div>
          </div>
          <button onClick={() => setRolePanel(true)}
            className="ml-auto flex items-center gap-2 rounded-full border border-stone-300 bg-white px-3 py-1.5 text-xs font-medium hover:border-stone-400">
            <span className="max-w-24 truncate">{name}</span>
            <RoleBadge role={role} />
          </button>
        </div>
        {/* Toolbar */}
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2 px-4 pb-3">
          <div className="flex rounded-lg border border-stone-300 bg-white p-0.5">
            {[0, 1].map((i) => {
              const l = dayLabel(i);
              return (
                <button key={i} onClick={() => setDay(i)}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium ${day === i ? "bg-stone-900 text-white" : "text-stone-600 hover:bg-stone-100"}`}>
                  {l.top} <span className={day === i ? "text-stone-300" : "text-stone-400"}>{l.sub}</span>
                </button>
              );
            })}
          </div>
          <div className="flex rounded-lg border border-stone-300 bg-white p-0.5">
            {["cal", "list"].map((v) => (
              <button key={v} onClick={() => setView(v)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium capitalize ${view === v ? "bg-stone-900 text-white" : "text-stone-600 hover:bg-stone-100"}`}>
                {v === "cal" ? "Grid" : "List"}
              </button>
            ))}
          </div>
          <button onClick={jumpToNow}
            className="rounded-lg px-3 py-2 text-xs font-semibold text-stone-900 shadow-sm hover:brightness-95"
            style={{ background: ACCENT }}>
            ● Now {fmtMin(nowMin)}
          </button>
          <div className="ml-auto flex items-center gap-2">
            {(role === "admin" || role === "user") && (
              <button onClick={() => setArrange((a) => !a)}
                className={`rounded-lg border px-3 py-2 text-xs font-medium ${arrange ? "border-stone-900 bg-stone-900 text-white" : "border-stone-300 bg-white text-stone-600 hover:border-stone-400"}`}>
                {arrange ? "Done arranging" : "Arrange"}
              </button>
            )}
            {canWrite && (
              <button onClick={() => setEditing({})}
                className="rounded-lg bg-stone-900 px-3 py-2 text-xs font-semibold text-white hover:bg-stone-700">
                + Add session
              </button>
            )}
          </div>
        </div>
        {/* Filters */}
        <div className="mx-auto max-w-6xl overflow-x-auto px-4 pb-3">
          <div className="flex items-center gap-1.5 whitespace-nowrap">
            <input value={filters.q} onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
              placeholder="Search title, speaker…"
              className="w-40 rounded-full border border-stone-300 bg-white px-3 py-1 text-xs outline-none focus:border-stone-500" />
            {ROOMS.map((r) => (
              <Chip key={r.id} active={filters.rooms.includes(r.id)}
                onClick={() => setFilters((f) => ({ ...f, rooms: toggle(f.rooms, r.id) }))}>
                {r.name}
              </Chip>
            ))}
            <span className="mx-1 h-4 w-px bg-stone-300" />
            {TAGS.map((t) => (
              <Chip key={t.id} active={filters.tags.includes(t.id)} dot={t.color}
                onClick={() => setFilters((f) => ({ ...f, tags: toggle(f.tags, t.id) }))}>
                {t.name}
              </Chip>
            ))}
            {anyFilter ? (
              <button onClick={() => setFilters({ rooms: [], tags: [], q: "" })}
                className="rounded-full px-2.5 py-1 text-xs font-medium text-stone-500 underline hover:text-stone-800">
                Clear
              </button>
            ) : null}
          </div>
        </div>
      </header>

      {/* Body */}
      <main className="mx-auto max-w-6xl px-0 sm:px-4">
        {view === "cal" ? (
          <Calendar scrollRef={calRef} sessions={visible} day={day} nowMin={nowMin}
            arrange={arrange} canEdit={canEdit} onOpen={setSelected} onMove={moveSession} />
        ) : (
          <ListView sessions={visible} nowMin={nowMin} day={day} contribs={contribs} onOpen={setSelected} />
        )}
        {visible.length === 0 && (
          <div className="py-16 text-center text-sm text-stone-500">
            No sessions match. <button className="underline" onClick={() => setFilters({ rooms: [], tags: [], q: "" })}>Clear filters</button>
          </div>
        )}
      </main>

      {selectedSession && (
        <DetailSheet session={selectedSession} contribs={contribs.filter((c) => c.sessionId === selectedSession.id)}
          role={role} name={name} canEdit={canEdit(selectedSession)}
          onClose={() => setSelected(null)}
          onEdit={() => setEditing({ session: selectedSession })}
          onDelete={() => deleteSession(selectedSession.id)}
          onAdd={(kind, body, url) => {
            setContribs((cs) => [...cs, { id: Date.now(), sessionId: selectedSession.id, kind, body, url, author: name, mins: 0 }]);
            setToast("Added — everyone sees it live");
          }}
          onRemoveContrib={(id) => setContribs((cs) => cs.filter((c) => c.id !== id))}
        />
      )}

      {editing && (
        <SessionModal initial={editing.session} role={role} day={day}
          onCancel={() => setEditing(null)}
          onSave={(data) => saveSession(data, editing.session?.id)}
          onDelete={editing.session ? () => deleteSession(editing.session.id) : null} />
      )}

      {rolePanel && (
        <RolePanel role={role} name={name} setName={setName}
          onClose={() => setRolePanel(false)}
          onRole={(r) => { setRole(r); setRolePanel(false); }}
          onSignOut={() => { setRole(null); setRolePanel(false); }} />
      )}

      {toast && (
        <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-stone-900 px-4 py-2 text-xs font-medium text-white shadow-lg">
          {toast}
        </div>
      )}

      {arrange && (
        <div className="fixed bottom-4 right-4 z-40 rounded-lg border border-stone-300 bg-white px-3 py-2 text-xs text-stone-600 shadow">
          Drag sessions you may edit · snaps to 5 min
        </div>
      )}
    </div>
  );
}

const toggle = (arr, v) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

function RoleBadge({ role }) {
  const style = { admin: "bg-stone-900 text-white", user: "bg-emerald-100 text-emerald-800", viewer: "bg-stone-200 text-stone-600" }[role];
  return <span className={`rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${style}`}>{role}</span>;
}

function Chip({ active, onClick, children, dot }) {
  return (
    <button onClick={onClick}
      className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${active ? "border-stone-900 bg-stone-900 text-white" : "border-stone-300 bg-white text-stone-600 hover:border-stone-400"}`}>
      {dot && <span className="h-2 w-2 rounded-full" style={{ background: dot }} />}
      {children}
    </button>
  );
}

/* ---------------------------- Gate ---------------------------- */

function Gate({ onEnter, name, setName }) {
  const [pw, setPw] = useState("");
  const [err, setErr] = useState(false);
  const submit = () => {
    const map = { admin2026: "admin", user2026: "user", viewer2026: "viewer" };
    const r = map[pw.trim()];
    if (r) onEnter(r); else { setErr(true); setTimeout(() => setErr(false), 1500); }
  };
  return (
    <div className="flex min-h-screen items-center justify-center bg-stone-100 px-4" style={{ fontFamily: "ui-sans-serif, system-ui, sans-serif" }}>
      <div className="w-full max-w-sm rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
        <div className="mb-1 flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-stone-900 text-sm font-bold text-white">D</div>
          <h1 className="text-lg font-semibold tracking-tight">DemoConf 2026</h1>
        </div>
        <p className="mb-5 text-sm text-stone-500">This schedule needs the event password.</p>
        <label className="mb-1 block text-xs font-medium text-stone-600">Event password</label>
        <input type="password" value={pw} onChange={(e) => setPw(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          className={`mb-3 w-full rounded-lg border px-3 py-2 text-sm outline-none focus:border-stone-500 ${err ? "border-red-400" : "border-stone-300"}`}
          placeholder="••••••••" />
        {err && <p className="-mt-2 mb-2 text-xs text-red-600">That password doesn't match this event.</p>}
        <button onClick={submit} className="w-full rounded-lg bg-stone-900 py-2 text-sm font-semibold text-white hover:bg-stone-700">
          Enter schedule
        </button>
        <div className="mt-5 border-t border-stone-100 pt-4">
          <label className="mb-1 block text-xs font-medium text-stone-600">You'll appear as</label>
          <input value={name} onChange={(e) => setName(e.target.value)}
            className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm outline-none focus:border-stone-500" />
          <p className="mt-1 text-xs text-stone-400">Remembered on this device. No account needed.</p>
        </div>
        <p className="mt-4 rounded-lg px-3 py-2 text-xs text-stone-700" style={{ background: "#FFF6D6" }}>
          Mockup passwords: <b>viewer2026</b> · <b>user2026</b> · <b>admin2026</b>
        </p>
      </div>
    </div>
  );
}

/* -------------------------- Calendar -------------------------- */

function laneLayout(sessions) {
  // greedy lanes per room for overlapping sessions
  const byRoom = {};
  for (const s of sessions) (byRoom[s.roomId] ||= []).push(s);
  const out = {};
  for (const roomId in byRoom) {
    const list = byRoom[roomId].slice().sort((a, b) => a.startMin - b.startMin);
    const lanes = [];
    for (const s of list) {
      let li = lanes.findIndex((end) => end <= s.startMin);
      if (li === -1) { lanes.push(s.startMin + s.durMin); li = lanes.length - 1; }
      else lanes[li] = s.startMin + s.durMin;
      out[s.id] = { lane: li, roomLanes: 0 };
    }
    for (const s of list) out[s.id].roomLanes = lanes.length;
  }
  return out;
}

function Calendar({ scrollRef, sessions, day, nowMin, arrange, canEdit, onOpen, onMove }) {
  const lanes = useMemo(() => laneLayout(sessions), [sessions]);
  const [drag, setDrag] = useState(null); // {id, dyMin, dRoom}
  const showNow = day === 0 && nowMin >= DAY_START && nowMin <= DAY_END;
  const height = (DAY_END - DAY_START) * PX_PER_MIN;

  const startDrag = (e, s) => {
    if (!arrange || !canEdit(s)) return;
    e.preventDefault();
    const startY = e.clientY, startX = e.clientX;
    let moved = false, dyMin = 0, dRoom = 0;
    const mm = (ev) => {
      dyMin = snap((ev.clientY - startY) / PX_PER_MIN);
      dRoom = Math.round((ev.clientX - startX) / COL_W);
      if (Math.abs(ev.clientY - startY) > 4 || Math.abs(ev.clientX - startX) > 4) moved = true;
      setDrag({ id: s.id, dyMin, dRoom });
    };
    const up = () => {
      window.removeEventListener("pointermove", mm);
      window.removeEventListener("pointerup", up);
      setDrag(null);
      if (!moved) { onOpen(s.id); return; }
      const newStart = clamp(s.startMin + dyMin, DAY_START, DAY_END - s.durMin);
      const idx = clamp(ROOMS.findIndex((r) => r.id === s.roomId) + dRoom, 0, ROOMS.length - 1);
      onMove(s.id, newStart, ROOMS[idx].id);
    };
    window.addEventListener("pointermove", mm);
    window.addEventListener("pointerup", up);
  };

  return (
    <div ref={scrollRef} className="overflow-auto border-t border-stone-200 bg-white sm:mt-2 sm:rounded-xl sm:border"
      style={{ maxHeight: "calc(100vh - 190px)" }}>
      <div className="relative" style={{ width: 48 + ROOMS.length * COL_W }}>
        {/* room headers */}
        <div className="sticky top-0 z-20 flex border-b border-stone-200 bg-white/95 backdrop-blur">
          <div className="w-12 shrink-0" />
          {ROOMS.map((r) => (
            <div key={r.id} className="border-l border-stone-100 px-3 py-2" style={{ width: COL_W }}>
              <div className="truncate text-xs font-semibold">{r.name}</div>
              <div className="text-xs text-stone-400">
                {r.capacity} seats{r.open ? " · " : ""}
                {r.open && <span className="font-medium text-emerald-700">open track</span>}
              </div>
            </div>
          ))}
        </div>

        <div className="relative flex" style={{ height }}>
          {/* time gutter */}
          <div className="sticky left-0 z-10 w-12 shrink-0 bg-white">
            {Array.from({ length: (DAY_END - DAY_START) / 60 + 1 }, (_, i) => (
              <div key={i} className="absolute -translate-y-1/2 pr-1 text-right text-xs text-stone-400"
                style={{ top: i * 60 * PX_PER_MIN, width: 44 }}>
                {fmtMin(DAY_START + i * 60)}
              </div>
            ))}
          </div>
          {/* grid lines */}
          {Array.from({ length: (DAY_END - DAY_START) / 30 }, (_, i) => (
            <div key={i} className={`absolute left-12 right-0 border-t ${i % 2 ? "border-stone-100" : "border-stone-200"}`}
              style={{ top: i * 30 * PX_PER_MIN }} />
          ))}
          {/* columns */}
          {ROOMS.map((r, i) => (
            <div key={r.id} className={`absolute bottom-0 top-0 border-l border-stone-100 ${r.open ? "bg-emerald-50/40" : ""}`}
              style={{ left: 48 + i * COL_W, width: COL_W }} />
          ))}

          {/* now line */}
          {showNow && (
            <div className="pointer-events-none absolute left-0 right-0 z-10" style={{ top: (nowMin - DAY_START) * PX_PER_MIN }}>
              <div className="h-0.5 w-full" style={{ background: ACCENT }} />
              <span className="absolute -top-2.5 left-12 rounded-r bg-stone-900 px-1.5 py-0.5 text-xs font-semibold text-white">
                {fmtMin(nowMin)}
              </span>
            </div>
          )}

          {/* sessions */}
          {sessions.map((s) => {
            const d = drag?.id === s.id ? drag : null;
            const start = s.startMin + (d ? d.dyMin : 0);
            const roomIdx = clamp(ROOMS.findIndex((r) => r.id === s.roomId) + (d ? d.dRoom : 0), 0, ROOMS.length - 1);
            const info = lanes[s.id] || { lane: 0, roomLanes: 1 };
            const w = (COL_W - 8) / info.roomLanes;
            const editable = arrange && canEdit(s);
            const live = day === 0 && nowMin >= s.startMin && nowMin < s.startMin + s.durMin;
            return (
              <div key={s.id}
                onPointerDown={(e) => startDrag(e, s)}
                onClick={() => { if (!editable) onOpen(s.id); }}
                className={`absolute overflow-hidden rounded-lg border bg-white p-2 text-left shadow-sm transition-shadow
                  ${s.type === "open" ? "border-dashed border-emerald-400" : "border-stone-200"}
                  ${editable ? "cursor-grab ring-1 ring-stone-300" : "cursor-pointer hover:shadow"}
                  ${d ? "z-30 opacity-90 shadow-lg" : ""}`}
                style={{
                  top: (start - DAY_START) * PX_PER_MIN,
                  left: 48 + roomIdx * COL_W + 4 + info.lane * w,
                  width: w - 2,
                  height: Math.max(s.durMin * PX_PER_MIN - 3, 22),
                  touchAction: editable ? "none" : "auto",
                }}>
                <div className="flex gap-1">
                  {s.tagIds.map((t) => (
                    <span key={t} className="mt-0.5 h-1 w-4 rounded-full" style={{ background: TAGS.find((x) => x.id === t)?.color }} />
                  ))}
                  {live && <span className="ml-auto rounded px-1 text-xs font-bold" style={{ background: ACCENT }}>now</span>}
                </div>
                <div className="mt-0.5 truncate text-xs font-semibold leading-tight">{s.title}</div>
                <div className="truncate text-xs text-stone-500">{fmtMin(s.startMin)}–{fmtMin(s.startMin + s.durMin)} · {s.speaker}</div>
                {s.type === "open" && <span className="text-xs font-medium text-emerald-700">open session</span>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* --------------------------- List view --------------------------- */

function ListView({ sessions, nowMin, day, contribs, onOpen }) {
  const sorted = sessions.slice().sort((a, b) => a.startMin - b.startMin || a.roomId - b.roomId);
  const groups = [];
  for (const s of sorted) {
    const last = groups[groups.length - 1];
    if (last && last.start === s.startMin) last.items.push(s);
    else groups.push({ start: s.startMin, items: [s] });
  }
  let anchorSet = false;
  return (
    <div className="px-4 pb-24 pt-3">
      {groups.map((g) => {
        const isNowGroup = day === 0 && !anchorSet && g.start + Math.max(...g.items.map((i) => i.durMin)) > nowMin;
        if (isNowGroup) anchorSet = true;
        return (
          <div key={g.start} id={isNowGroup ? "now-anchor" : undefined} className="mb-4">
            <div className="mb-1.5 flex items-center gap-2 text-xs font-semibold text-stone-500">
              {fmtMin(g.start)}
              {isNowGroup && <span className="rounded px-1.5 py-0.5 font-bold text-stone-900" style={{ background: ACCENT }}>next / now</span>}
            </div>
            <div className="space-y-2">
              {g.items.map((s) => {
                const live = day === 0 && nowMin >= s.startMin && nowMin < s.startMin + s.durMin;
                const n = contribs.filter((c) => c.sessionId === s.id).length;
                return (
                  <button key={s.id} onClick={() => onOpen(s.id)}
                    className={`block w-full rounded-xl border bg-white p-3 text-left shadow-sm hover:shadow ${s.type === "open" ? "border-dashed border-emerald-400" : "border-stone-200"} ${live ? "ring-2 ring-stone-900/10" : ""}`}>
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold">{s.title}</div>
                        <div className="mt-0.5 text-xs text-stone-500">
                          {fmtMin(s.startMin)}–{fmtMin(s.startMin + s.durMin)} · {ROOMS.find((r) => r.id === s.roomId)?.name} · {s.speaker}
                        </div>
                      </div>
                      {live && <span className="rounded px-1.5 py-0.5 text-xs font-bold" style={{ background: ACCENT }}>now</span>}
                    </div>
                    <div className="mt-2 flex items-center gap-1.5">
                      {s.tagIds.map((t) => {
                        const tag = TAGS.find((x) => x.id === t);
                        return <span key={t} className="rounded-full px-2 py-0.5 text-xs font-medium text-white" style={{ background: tag?.color }}>{tag?.name}</span>;
                      })}
                      {s.type === "open" && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">open</span>}
                      {n > 0 && <span className="ml-auto text-xs text-stone-400">{n} contribution{n > 1 ? "s" : ""}</span>}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* -------------------------- Detail sheet -------------------------- */

function DetailSheet({ session: s, contribs, role, name, canEdit, onClose, onEdit, onDelete, onAdd, onRemoveContrib }) {
  const [kind, setKind] = useState("question");
  const [body, setBody] = useState("");
  const [url, setUrl] = useState("");
  const room = ROOMS.find((r) => r.id === s.roomId);
  const submit = () => {
    if (!body.trim()) return;
    if (kind === "link" && !/^https?:\/\//.test(url)) return;
    onAdd(kind, body.trim(), kind === "link" ? url : undefined);
    setBody(""); setUrl("");
  };
  return (
    <div className="fixed inset-0 z-40" onClick={onClose}>
      <div className="absolute inset-0 bg-stone-900/30" />
      <div onClick={(e) => e.stopPropagation()}
        className="absolute inset-x-0 bottom-0 max-h-[85vh] overflow-y-auto rounded-t-2xl border border-stone-200 bg-white p-5 shadow-xl sm:bottom-auto sm:left-auto sm:right-4 sm:top-4 sm:h-auto sm:max-h-[92vh] sm:w-96 sm:rounded-2xl">
        <div className="mb-3 flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              {s.type === "open"
                ? <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">open session</span>
                : <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs font-semibold text-stone-600">official</span>}
              {s.tagIds.map((t) => {
                const tag = TAGS.find((x) => x.id === t);
                return <span key={t} className="rounded-full px-2 py-0.5 text-xs font-medium text-white" style={{ background: tag?.color }}>{tag?.name}</span>;
              })}
            </div>
            <h2 className="mt-1.5 text-lg font-semibold leading-snug tracking-tight">{s.title}</h2>
            <p className="mt-1 text-sm text-stone-500">
              {fmtMin(s.startMin)}–{fmtMin(s.startMin + s.durMin)} · {room?.name} · {s.speaker || "no speaker yet"}
            </p>
          </div>
          <button onClick={onClose} className="rounded-full p-1.5 text-stone-400 hover:bg-stone-100">✕</button>
        </div>

        {s.desc && <p className="mb-4 whitespace-pre-wrap text-sm leading-relaxed text-stone-700">{s.desc}</p>}

        {canEdit && (
          <div className="mb-4 flex gap-2">
            <button onClick={onEdit} className="flex-1 rounded-lg border border-stone-300 py-1.5 text-xs font-semibold hover:border-stone-500">Edit session</button>
            <button onClick={onDelete} className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50">Delete</button>
          </div>
        )}

        {["question", "note", "link"].map((k) => {
          const items = contribs.filter((c) => c.kind === k);
          if (!items.length) return null;
          return (
            <div key={k} className="mb-3">
              <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-stone-400">{KIND_META[k].label}</h3>
              <ul className="space-y-1.5">
                {items.map((c) => (
                  <li key={c.id} className="group rounded-lg bg-stone-50 px-3 py-2 text-sm">
                    {c.kind === "link"
                      ? <a href={c.url} target="_blank" rel="noopener noreferrer" className="font-medium text-blue-700 underline">{c.body} ↗</a>
                      : <span className="text-stone-800">{c.body}</span>}
                    <div className="mt-0.5 flex items-center text-xs text-stone-400">
                      {c.author} · {c.mins === 0 ? "just now" : `${c.mins}m ago`}
                      {(role === "admin" || c.author === name) && (
                        <button onClick={() => onRemoveContrib(c.id)} className="ml-auto text-red-500 opacity-0 group-hover:opacity-100">remove</button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
        {contribs.length === 0 && <p className="mb-3 text-sm text-stone-400">No notes, links or questions yet.</p>}

        {role === "viewer" ? (
          <p className="rounded-lg bg-stone-50 px-3 py-2 text-xs text-stone-500">Enter the user password (tap your name, top right) to add notes, links and questions.</p>
        ) : (
          <div className="rounded-xl border border-stone-200 p-3">
            <div className="mb-2 flex gap-1.5">
              {["question", "note", "link"].map((k) => (
                <button key={k} onClick={() => setKind(k)}
                  className={`rounded-full px-2.5 py-1 text-xs font-medium capitalize ${kind === k ? "bg-stone-900 text-white" : "bg-stone-100 text-stone-600"}`}>
                  {k}
                </button>
              ))}
            </div>
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={2}
              placeholder={kind === "link" ? "Link label" : `Add a ${kind}…`}
              className="w-full resize-none rounded-lg border border-stone-300 px-3 py-2 text-sm outline-none focus:border-stone-500" />
            {kind === "link" && (
              <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…"
                className="mt-1.5 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm outline-none focus:border-stone-500" />
            )}
            <button onClick={submit} className="mt-2 w-full rounded-lg bg-stone-900 py-1.5 text-xs font-semibold text-white hover:bg-stone-700">
              Post as {name}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* -------------------------- Session modal -------------------------- */

function SessionModal({ initial, role, day, onCancel, onSave, onDelete }) {
  const isAdmin = role === "admin";
  const allowedRooms = isAdmin ? ROOMS : ROOMS.filter((r) => r.open);
  const [f, setF] = useState(() => ({
    title: initial?.title || "",
    speaker: initial?.speaker || "",
    desc: initial?.desc || "",
    roomId: initial?.roomId || allowedRooms[0]?.id,
    day: initial?.day ?? day,
    start: fmtMin(initial?.startMin ?? 14 * 60),
    durMin: initial?.durMin || 30,
    tagIds: initial?.tagIds || [],
    type: initial?.type || (isAdmin ? "official" : "open"),
  }));
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const save = () => {
    if (!f.title.trim()) return;
    const [h, m] = f.start.split(":").map(Number);
    onSave({
      title: f.title.trim(), speaker: f.speaker.trim(), desc: f.desc.trim(),
      roomId: Number(f.roomId), day: Number(f.day),
      startMin: clamp(snap(h * 60 + m), DAY_START, DAY_END - 5),
      durMin: Number(f.durMin), tagIds: f.tagIds, type: f.type,
    });
  };
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" onClick={onCancel}>
      <div className="absolute inset-0 bg-stone-900/40" />
      <div onClick={(e) => e.stopPropagation()}
        className="relative max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-5 sm:rounded-2xl">
        <h2 className="mb-4 text-base font-semibold tracking-tight">
          {initial ? "Edit session" : isAdmin ? "Add session" : "Propose an open session"}
        </h2>
        {!isAdmin && <p className="-mt-2 mb-3 text-xs text-stone-500">Open sessions live in open-track rooms and stay editable by you.</p>}
        <Field label="Title"><input value={f.title} onChange={(e) => set("title", e.target.value)} className={inp} maxLength={120} /></Field>
        <Field label="Speaker / host"><input value={f.speaker} onChange={(e) => set("speaker", e.target.value)} className={inp} /></Field>
        <Field label="Description"><textarea value={f.desc} onChange={(e) => set("desc", e.target.value)} rows={3} className={inp + " resize-none"} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Room">
            <select value={f.roomId} onChange={(e) => set("roomId", e.target.value)} className={inp}>
              {allowedRooms.map((r) => <option key={r.id} value={r.id}>{r.name}{r.open ? " (open)" : ""}</option>)}
            </select>
          </Field>
          <Field label="Day">
            <select value={f.day} onChange={(e) => set("day", e.target.value)} className={inp}>
              {[0, 1].map((i) => <option key={i} value={i}>{dayLabel(i).top}</option>)}
            </select>
          </Field>
          <Field label="Start (5-min steps)"><input type="time" step={300} value={f.start} onChange={(e) => set("start", e.target.value)} className={inp} /></Field>
          <Field label="Duration">
            <select value={f.durMin} onChange={(e) => set("durMin", e.target.value)} className={inp}>
              {[15, 30, 45, 60, 90, 120].map((d) => <option key={d} value={d}>{d} min</option>)}
            </select>
          </Field>
        </div>
        <Field label="Tags">
          <div className="flex flex-wrap gap-1.5">
            {TAGS.map((t) => (
              <Chip key={t.id} dot={t.color} active={f.tagIds.includes(t.id)} onClick={() => set("tagIds", toggle(f.tagIds, t.id))}>{t.name}</Chip>
            ))}
          </div>
        </Field>
        {isAdmin && (
          <Field label="Type">
            <div className="flex gap-1.5">
              {["official", "open"].map((t) => (
                <Chip key={t} active={f.type === t} onClick={() => set("type", t)}>{t}</Chip>
              ))}
            </div>
          </Field>
        )}
        <div className="mt-4 flex gap-2">
          {onDelete && <button onClick={onDelete} className="rounded-lg border border-red-200 px-3 py-2 text-xs font-semibold text-red-600 hover:bg-red-50">Delete</button>}
          <button onClick={onCancel} className="ml-auto rounded-lg border border-stone-300 px-4 py-2 text-xs font-semibold hover:border-stone-500">Cancel</button>
          <button onClick={save} className="rounded-lg bg-stone-900 px-4 py-2 text-xs font-semibold text-white hover:bg-stone-700">Save</button>
        </div>
      </div>
    </div>
  );
}

const inp = "w-full rounded-lg border border-stone-300 px-3 py-2 text-sm outline-none focus:border-stone-500 bg-white";
function Field({ label, children }) {
  return (
    <div className="mb-3">
      <label className="mb-1 block text-xs font-medium text-stone-600">{label}</label>
      {children}
    </div>
  );
}

/* --------------------------- Role panel --------------------------- */

function RolePanel({ role, name, setName, onClose, onRole, onSignOut }) {
  const [pw, setPw] = useState("");
  const [err, setErr] = useState(false);
  const change = () => {
    const map = { admin2026: "admin", user2026: "user", viewer2026: "viewer" };
    const r = map[pw.trim()];
    if (r) { onRole(r); } else { setErr(true); setTimeout(() => setErr(false), 1500); }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" onClick={onClose}>
      <div className="absolute inset-0 bg-stone-900/40" />
      <div onClick={(e) => e.stopPropagation()} className="relative w-full max-w-sm rounded-t-2xl bg-white p-5 sm:rounded-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold tracking-tight">Your identity</h2>
          <RoleBadge role={role} />
        </div>
        <Field label="Display name (saved on this device)">
          <input value={name} onChange={(e) => setName(e.target.value)} className={inp} maxLength={40} />
        </Field>
        <Field label="Change role — enter another event password">
          <div className="flex gap-2">
            <input type="password" value={pw} onChange={(e) => setPw(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && change()}
              className={inp + (err ? " border-red-400" : "")} placeholder="••••••••" />
            <button onClick={change} className="shrink-0 rounded-lg bg-stone-900 px-3 text-xs font-semibold text-white">Apply</button>
          </div>
          {err && <p className="mt-1 text-xs text-red-600">No role matches that password.</p>}
        </Field>
        <div className="mt-2 flex items-center justify-between">
          <button onClick={onSignOut} className="text-xs font-medium text-stone-500 underline">Sign out of event</button>
          <button onClick={onClose} className="rounded-lg border border-stone-300 px-4 py-2 text-xs font-semibold">Done</button>
        </div>
        <p className="mt-4 rounded-lg px-3 py-2 text-xs text-stone-700" style={{ background: "#FFF6D6" }}>
          Try: <b>viewer2026</b> · <b>user2026</b> · <b>admin2026</b>
        </p>
      </div>
    </div>
  );
}
