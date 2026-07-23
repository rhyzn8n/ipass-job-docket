import React, { useState, useEffect, useMemo } from "react";
import {
  LayoutDashboard, FilePlus2, KanbanSquare, BarChart3, Users, Flag,
  Clock, CheckCircle2, AlertTriangle, X, Plus, Trash2, Pencil, Send,
  MessageSquarePlus, Star, ChevronRight
} from "lucide-react";
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, PieChart, Pie, Cell
} from "recharts";
import { storage } from "./firebase.js";

const STATUSES = ["New", "Assigned", "In Progress", "In Revision", "Review", "Completed"];
const PRIORITIES = ["Low", "Normal", "High", "Urgent"];
const DEPTS = ["Social Media", "SEO", "Other"];
const ROLES = ["Requester", "Artist", "Team Lead", "Admin"];

const PRIORITY_COLOR = { Low: "var(--muted)", Normal: "var(--teal)", High: "var(--amber)", Urgent: "var(--coral)" };
const PIE_COLORS = ["var(--amber)", "var(--teal)", "var(--coral)", "var(--muted)"];

const todayISO = () => new Date().toISOString().slice(0, 10);
const monthKey = (isoDate) => (isoDate ? isoDate.slice(0, 7) : "");
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

function revisionEquivalent(ticket) {
  const minor = ticket.revisions.filter((r) => r.type === "minor").length;
  const major = ticket.revisions.filter((r) => r.type === "major").length;
  return minor / 3 + major;
}

function ticketAccuracy(ticket) {
  if (ticket.status !== "Completed") return null;
  const parts = [];
  if (ticket.satisfactionScore) parts.push((ticket.satisfactionScore / 5) * 100);
  if (ticket.briefCompliance) parts.push((ticket.briefCompliance / 5) * 100);
  parts.push(Math.max(0, 100 - revisionEquivalent(ticket) * 10));
  return Math.round(parts.reduce((a, b) => a + b, 0) / parts.length);
}

function seedRoster() {
  return [
    { id: uid(), name: "Art Team Lead", role: "Team Lead", dept: "Other" },
    { id: uid(), name: "Graphic Artist 1", role: "Artist", dept: "Other" },
    { id: uid(), name: "Graphic Artist 2", role: "Artist", dept: "Other" },
    { id: uid(), name: "Social Media Manager", role: "Requester", dept: "Social Media" },
    { id: uid(), name: "SEO Specialist", role: "Requester", dept: "SEO" },
  ];
}

function StampBadge({ priority }) {
  return (
    <span
      className="inline-flex items-center justify-center px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest border-2 border-dashed rounded-full -rotate-6 select-none"
      style={{ color: PRIORITY_COLOR[priority], borderColor: PRIORITY_COLOR[priority], fontFamily: "var(--font-mono)" }}
    >
      {priority}
    </span>
  );
}

function StatusPill({ status }) {
  const map = {
    New: "bg-[var(--line)] text-[var(--ink)]",
    Assigned: "bg-[var(--amber)]/20 text-[var(--ink)]",
    "In Progress": "bg-[var(--amber)]/40 text-[var(--ink)]",
    "In Revision": "bg-[var(--coral)]/20 text-[var(--ink)]",
    Review: "bg-[var(--teal)]/20 text-[var(--ink)]",
    Completed: "bg-[var(--teal)] text-[var(--paper)]",
  };
  return (
    <span className={`px-2 py-0.5 text-[11px] font-semibold rounded ${map[status] || ""}`}>
      {status}
    </span>
  );
}

function nameOf(roster, id) {
  return roster.find((m) => m.id === id)?.name || "Unassigned";
}

export default function CreativeOpsApp() {
  const [roster, setRoster] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [ticketSeq, setTicketSeq] = useState(0);
  const [currentUserId, setCurrentUserId] = useState("");
  const [view, setView] = useState("dashboard");
  const [ready, setReady] = useState(false);
  const [openTicketId, setOpenTicketId] = useState(null);

  useEffect(() => {
    (async () => {
      let r = seedRoster();
      let t = [];
      let seq = 0;
      let cu = "";
      try {
        const res = await storage.get("roster", true);
        if (res && res.value) r = JSON.parse(res.value);
        else await storage.set("roster", JSON.stringify(r), true);
      } catch (e) {
        try { await storage.set("roster", JSON.stringify(r), true); } catch (e2) {}
      }
      try {
        const res = await storage.get("tickets", true);
        if (res && res.value) t = JSON.parse(res.value);
      } catch (e) {}
      try {
        const res = await storage.get("ticket_seq", true);
        if (res && res.value) seq = JSON.parse(res.value);
      } catch (e) {}
      try {
        const res = await storage.get("current_user", false);
        if (res && res.value) cu = res.value;
      } catch (e) {}
      setRoster(r);
      setTickets(t);
      setTicketSeq(seq);
      setCurrentUserId(cu && r.find((m) => m.id === cu) ? cu : r[0]?.id || "");
      setReady(true);
    })();
  }, []);

  const saveRoster = async (next) => {
    setRoster(next);
    try { await storage.set("roster", JSON.stringify(next), true); } catch (e) {}
  };
  const saveTickets = async (next) => {
    setTickets(next);
    try { await storage.set("tickets", JSON.stringify(next), true); } catch (e) {}
  };
  const saveSeq = async (next) => {
    setTicketSeq(next);
    try { await storage.set("ticket_seq", JSON.stringify(next), true); } catch (e) {}
  };
  const pickUser = async (id) => {
    setCurrentUserId(id);
    try { await storage.set("current_user", id, false); } catch (e) {}
  };

  const currentUser = roster.find((m) => m.id === currentUserId);
  const isLead = currentUser?.role === "Team Lead" || currentUser?.role === "Admin";

  const logHistory = (ticket, action) => ({
    ...ticket,
    history: [...ticket.history, { date: new Date().toISOString(), action, by: currentUser?.name || "Unknown" }],
  });

  const updateTicket = (id, updater) => {
    const next = tickets.map((t) => (t.id === id ? logHistory(updater({ ...t }), updater.__label || "Updated") : t));
    saveTickets(next);
  };

  const createTicket = (data) => {
    const nextSeq = ticketSeq + 1;
    const t = {
      id: uid(),
      ticketNo: nextSeq,
      title: data.title,
      description: data.description,
      dept: data.dept,
      requestedBy: data.requestedBy,
      assignedTo: data.assignedTo || null,
      priority: data.priority,
      status: data.assignedTo ? "Assigned" : "New",
      dateRequested: todayISO(),
      dueDate: data.dueDate || null,
      dateCompleted: null,
      revisions: [],
      satisfactionScore: null,
      briefCompliance: null,
      history: [{ date: new Date().toISOString(), action: "Request logged", by: currentUser?.name || "Unknown" }],
    };
    saveTickets([t, ...tickets]);
    saveSeq(nextSeq);
    setView("board");
  };

  const openTicket = tickets.find((t) => t.id === openTicketId);

  if (!ready) {
    return (
      <div className="min-h-[400px] flex items-center justify-center text-[var(--muted)]" style={{ fontFamily: "var(--font-mono)" }}>
        loading docket…
      </div>
    );
  }

  return (
    <div style={{ fontFamily: "var(--font-body)", background: "var(--paper)", color: "var(--ink)" }} className="min-h-[600px] w-full">
      <FontStyles />
      <Header roster={roster} currentUserId={currentUserId} pickUser={pickUser} />
      <TabBar view={view} setView={setView} />
      <main className="px-4 md:px-8 py-6 max-w-6xl mx-auto">
        {view === "dashboard" && <DashboardView tickets={tickets} roster={roster} onOpen={setOpenTicketId} setView={setView} />}
        {view === "new" && <NewRequestForm roster={roster} currentUser={currentUser} onCreate={createTicket} />}
        {view === "board" && (
          <BoardView
            tickets={tickets}
            roster={roster}
            onOpen={setOpenTicketId}
          />
        )}
        {view === "reports" && <ReportsView tickets={tickets} roster={roster} />}
        {view === "team" && <TeamView roster={roster} saveRoster={saveRoster} />}
      </main>
      {openTicket && (
        <TicketModal
          ticket={openTicket}
          roster={roster}
          currentUser={currentUser}
          isLead={isLead}
          onClose={() => setOpenTicketId(null)}
          onUpdate={updateTicket}
        />
      )}
    </div>
  );
}

function FontStyles() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Archivo:wght@700;900&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500;600&display=swap');
      :root {
        --paper: #F3F1EA;
        --ink: #221F26;
        --amber: #D99A2B;
        --teal: #2E6B60;
        --coral: #C6543D;
        --line: #DAD5C7;
        --muted: #8C8672;
        --font-display: 'Archivo', sans-serif;
        --font-body: 'IBM Plex Sans', sans-serif;
        --font-mono: 'IBM Plex Mono', monospace;
      }
      .docket-perf {
        height: 10px;
        background-image: radial-gradient(circle, var(--paper) 3.2px, transparent 3.6px);
        background-size: 14px 100%;
        background-position: center;
      }
    `}</style>
  );
}

function Header({ roster, currentUserId, pickUser }) {
  return (
    <div className="border-b-2" style={{ borderColor: "var(--ink)" }}>
      <div className="max-w-6xl mx-auto px-4 md:px-8 pt-6 pb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-[0.3em]" style={{ color: "var(--muted)", fontFamily: "var(--font-mono)" }}>
            IPASS · Creative Production
          </div>
          <h1 className="text-3xl md:text-4xl font-black tracking-tight" style={{ fontFamily: "var(--font-display)" }}>
            Job Docket
          </h1>
        </div>
        <label className="text-sm flex items-center gap-2" style={{ color: "var(--muted)" }}>
          Acting as
          <select
            value={currentUserId}
            onChange={(e) => pickUser(e.target.value)}
            className="border rounded px-2 py-1 text-sm bg-white"
            style={{ borderColor: "var(--line)", fontFamily: "var(--font-mono)", color: "var(--ink)" }}
          >
            {roster.map((m) => (
              <option key={m.id} value={m.id}>{m.name} — {m.role}</option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}

function TabBar({ view, setView }) {
  const tabs = [
    { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    { id: "new", label: "New Request", icon: FilePlus2 },
    { id: "board", label: "Board", icon: KanbanSquare },
    { id: "reports", label: "Reports", icon: BarChart3 },
    { id: "team", label: "Team", icon: Users },
  ];
  return (
    <div className="border-b" style={{ borderColor: "var(--line)", background: "white" }}>
      <div className="max-w-6xl mx-auto px-4 md:px-8 flex gap-1 overflow-x-auto">
        {tabs.map((t) => {
          const Icon = t.icon;
          const active = view === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setView(t.id)}
              className="flex items-center gap-1.5 px-3 py-3 text-sm font-semibold whitespace-nowrap border-b-2 -mb-px transition-colors"
              style={{
                borderColor: active ? "var(--amber)" : "transparent",
                color: active ? "var(--ink)" : "var(--muted)",
              }}
            >
              <Icon size={15} /> {t.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function TicketCard({ ticket, roster, onOpen }) {
  const overdue = ticket.dueDate && ticket.status !== "Completed" && ticket.dueDate < todayISO();
  return (
    <button onClick={() => onOpen(ticket.id)} className="text-left w-full bg-white rounded-md shadow-sm border hover:shadow-md transition-shadow" style={{ borderColor: "var(--line)" }}>
      <div className="docket-perf" />
      <div className="p-3">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[11px]" style={{ fontFamily: "var(--font-mono)", color: "var(--muted)" }}>
            JOB-{String(ticket.ticketNo).padStart(4, "0")}
          </span>
          <StampBadge priority={ticket.priority} />
        </div>
        <div className="font-semibold text-sm leading-snug mb-1">{ticket.title}</div>
        <div className="text-xs mb-2" style={{ color: "var(--muted)" }}>{ticket.dept} · {nameOf(roster, ticket.assignedTo)}</div>
        <div className="flex items-center justify-between">
          <StatusPill status={ticket.status} />
          {overdue && <span className="flex items-center gap-1 text-[11px] font-semibold" style={{ color: "var(--coral)" }}><AlertTriangle size={12} /> overdue</span>}
        </div>
      </div>
    </button>
  );
}

function DashboardView({ tickets, roster, onOpen, setView }) {
  const open = tickets.filter((t) => t.status !== "Completed");
  const overdue = open.filter((t) => t.dueDate && t.dueDate < todayISO());
  const byPriority = PRIORITIES.map((p) => ({ name: p, value: open.filter((t) => t.priority === p).length }));
  const recent = tickets
    .flatMap((t) => t.history.map((h) => ({ ...h, ticket: t })))
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 8);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Open tickets" value={open.length} icon={KanbanSquare} />
        <StatCard label="Overdue" value={overdue.length} icon={AlertTriangle} alert={overdue.length > 0} />
        <StatCard label="Urgent priority" value={open.filter((t) => t.priority === "Urgent").length} icon={Flag} />
        <StatCard label="Completed total" value={tickets.filter((t) => t.status === "Completed").length} icon={CheckCircle2} />
      </div>

      <div className="grid md:grid-cols-3 gap-4">
        <div className="md:col-span-2 bg-white border rounded-md p-4" style={{ borderColor: "var(--line)" }}>
          <SectionTitle>Priority board — open jobs</SectionTitle>
          {open.length === 0 ? (
            <EmptyState text="No open jobs. New requests will land here." />
          ) : (
            <div className="grid sm:grid-cols-2 gap-3 mt-3">
              {open.slice(0, 6).map((t) => <TicketCard key={t.id} ticket={t} roster={roster} onOpen={onOpen} />)}
            </div>
          )}
          {open.length > 6 && (
            <button onClick={() => setView("board")} className="mt-3 text-sm font-semibold flex items-center gap-1" style={{ color: "var(--teal)" }}>
              View full board <ChevronRight size={14} />
            </button>
          )}
        </div>

        <div className="bg-white border rounded-md p-4" style={{ borderColor: "var(--line)" }}>
          <SectionTitle>Recent activity</SectionTitle>
          <div className="mt-3 space-y-3">
            {recent.length === 0 && <EmptyState text="No activity yet." />}
            {recent.map((h, i) => (
              <div key={i} className="text-xs">
                <div className="font-semibold">{h.action}</div>
                <div style={{ color: "var(--muted)" }}>
                  JOB-{String(h.ticket.ticketNo).padStart(4, "0")} · {h.by} · {new Date(h.date).toLocaleDateString()}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, icon: Icon, alert }) {
  return (
    <div className="bg-white border rounded-md p-3" style={{ borderColor: alert ? "var(--coral)" : "var(--line)" }}>
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider" style={{ color: "var(--muted)" }}>
        <Icon size={13} /> {label}
      </div>
      <div className="text-2xl font-black mt-1" style={{ fontFamily: "var(--font-display)", color: alert ? "var(--coral)" : "var(--ink)" }}>
        {value}
      </div>
    </div>
  );
}

function SectionTitle({ children }) {
  return <div className="text-xs font-bold uppercase tracking-widest" style={{ color: "var(--muted)" }}>{children}</div>;
}

function EmptyState({ text }) {
  return <div className="text-sm py-6 text-center" style={{ color: "var(--muted)" }}>{text}</div>;
}

function NewRequestForm({ roster, currentUser, onCreate }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dept, setDept] = useState(currentUser?.dept || "Social Media");
  const [requestedBy, setRequestedBy] = useState(currentUser?.id || "");
  const [assignedTo, setAssignedTo] = useState("");
  const [priority, setPriority] = useState("Normal");
  const [dueDate, setDueDate] = useState("");
  const [confirm, setConfirm] = useState(false);

  const artists = roster.filter((m) => m.role === "Artist" || m.role === "Team Lead");

  const submit = (e) => {
    e.preventDefault();
    if (!title.trim() || !requestedBy) return;
    onCreate({ title, description, dept, requestedBy, assignedTo, priority, dueDate });
    setTitle(""); setDescription(""); setAssignedTo(""); setDueDate(""); setPriority("Normal");
    setConfirm(true);
    setTimeout(() => setConfirm(false), 2500);
  };

  return (
    <form onSubmit={submit} className="bg-white border rounded-md p-5 max-w-2xl space-y-4" style={{ borderColor: "var(--line)" }}>
      <SectionTitle>Log a new creative request</SectionTitle>
      <Field label="Title">
        <input value={title} onChange={(e) => setTitle(e.target.value)} required className="w-full border rounded px-3 py-2 text-sm" style={{ borderColor: "var(--line)" }} placeholder="e.g. Instagram carousel — NCLEX AUS promo" />
      </Field>
      <Field label="Description / brief">
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} className="w-full border rounded px-3 py-2 text-sm" style={{ borderColor: "var(--line)" }} placeholder="Specs, references, deadline context, brand notes…" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Requested by">
          <select value={requestedBy} onChange={(e) => setRequestedBy(e.target.value)} className="w-full border rounded px-3 py-2 text-sm" style={{ borderColor: "var(--line)" }}>
            {roster.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </Field>
        <Field label="Department">
          <select value={dept} onChange={(e) => setDept(e.target.value)} className="w-full border rounded px-3 py-2 text-sm" style={{ borderColor: "var(--line)" }}>
            {DEPTS.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </Field>
        <Field label="Priority">
          <select value={priority} onChange={(e) => setPriority(e.target.value)} className="w-full border rounded px-3 py-2 text-sm" style={{ borderColor: "var(--line)" }}>
            {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </Field>
        <Field label="Due date (optional)">
          <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="w-full border rounded px-3 py-2 text-sm" style={{ borderColor: "var(--line)" }} />
        </Field>
      </div>
      <Field label="Assign to (optional — can be assigned later on the Board)">
        <select value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} className="w-full border rounded px-3 py-2 text-sm" style={{ borderColor: "var(--line)" }}>
          <option value="">— Unassigned —</option>
          {artists.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
      </Field>
      <button type="submit" className="flex items-center gap-2 px-4 py-2 rounded font-semibold text-sm text-white" style={{ background: "var(--ink)" }}>
        <Send size={14} /> Log request
      </button>
      {confirm && <div className="text-sm font-semibold" style={{ color: "var(--teal)" }}>Request logged.</div>}
    </form>
  );
}

function Field({ label, children }) {
  return (
    <label className="block text-xs font-semibold" style={{ color: "var(--muted)" }}>
      <span className="block mb-1 uppercase tracking-wide">{label}</span>
      {children}
    </label>
  );
}

function BoardView({ tickets, roster, onOpen }) {
  const [filterAssignee, setFilterAssignee] = useState("");
  const [filterPriority, setFilterPriority] = useState("");
  const filtered = tickets.filter(
    (t) => (!filterAssignee || t.assignedTo === filterAssignee) && (!filterPriority || t.priority === filterPriority)
  );
  return (
    <div>
      <div className="flex flex-wrap gap-3 mb-4 items-center">
        <SectionTitle>Board</SectionTitle>
        <select value={filterAssignee} onChange={(e) => setFilterAssignee(e.target.value)} className="border rounded px-2 py-1 text-xs" style={{ borderColor: "var(--line)" }}>
          <option value="">All assignees</option>
          {roster.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        <select value={filterPriority} onChange={(e) => setFilterPriority(e.target.value)} className="border rounded px-2 py-1 text-xs" style={{ borderColor: "var(--line)" }}>
          <option value="">All priorities</option>
          {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>
      <div className="flex gap-3 overflow-x-auto pb-4">
        {STATUSES.map((s) => (
          <div key={s} className="min-w-[240px] w-[240px] flex-shrink-0">
            <div className="text-xs font-bold uppercase tracking-wide mb-2 flex items-center justify-between" style={{ color: "var(--muted)" }}>
              {s} <span>{filtered.filter((t) => t.status === s).length}</span>
            </div>
            <div className="space-y-2">
              {filtered.filter((t) => t.status === s).map((t) => (
                <TicketCard key={t.id} ticket={t} roster={roster} onOpen={onOpen} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TicketModal({ ticket, roster, currentUser, isLead, onClose, onUpdate }) {
  const [note, setNote] = useState("");
  const [revType, setRevType] = useState("minor");
  const [sat, setSat] = useState(ticket.satisfactionScore || 0);
  const [comp, setComp] = useState(ticket.briefCompliance || 0);

  const artists = roster.filter((m) => m.role === "Artist" || m.role === "Team Lead");
  const isAssignee = ticket.assignedTo === currentUser?.id;
  const isRequester = ticket.requestedBy === currentUser?.id;
  const revEq = revisionEquivalent(ticket);
  const acc = ticketAccuracy(ticket);

  const assign = (memberId) => {
    onUpdate(ticket.id, Object.assign((t) => ({ ...t, assignedTo: memberId, status: t.status === "New" ? "Assigned" : t.status }), { __label: `Assigned to ${nameOf(roster, memberId)}` }));
  };
  const setStatus = (status) => {
    onUpdate(ticket.id, Object.assign((t) => ({ ...t, status }), { __label: `Status → ${status}` }));
  };
  const addRevision = () => {
    if (!note.trim()) return;
    onUpdate(ticket.id, Object.assign(
      (t) => ({ ...t, revisions: [...t.revisions, { id: uid(), type: revType, note, taggedBy: currentUser?.name, date: new Date().toISOString() }] }),
      { __label: `${revType === "minor" ? "Minor" : "Major"} revision logged` }
    ));
    setNote("");
  };
  const setCompliance = (v) => {
    setComp(v);
    onUpdate(ticket.id, Object.assign((t) => ({ ...t, briefCompliance: v }), { __label: `Brief compliance rated ${v}/5` }));
  };
  const setSatisfaction = (v) => {
    setSat(v);
    onUpdate(ticket.id, Object.assign((t) => ({ ...t, satisfactionScore: v }), { __label: `Satisfaction rated ${v}/5` }));
  };
  const complete = () => {
    onUpdate(ticket.id, Object.assign((t) => ({ ...t, status: "Completed", dateCompleted: todayISO() }), { __label: "Approved & completed" }));
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-start md:items-center justify-center z-50 p-3 overflow-y-auto" onClick={onClose}>
      <div className="bg-white rounded-md max-w-xl w-full my-6" style={{ fontFamily: "var(--font-body)" }} onClick={(e) => e.stopPropagation()}>
        <div className="docket-perf" />
        <div className="p-5">
          <div className="flex items-start justify-between mb-2">
            <div>
              <div className="text-[11px]" style={{ fontFamily: "var(--font-mono)", color: "var(--muted)" }}>
                JOB-{String(ticket.ticketNo).padStart(4, "0")} · {ticket.dept}
              </div>
              <h2 className="text-xl font-black" style={{ fontFamily: "var(--font-display)" }}>{ticket.title}</h2>
            </div>
            <button onClick={onClose}><X size={18} /></button>
          </div>
          <div className="flex items-center gap-2 mb-3">
            <StampBadge priority={ticket.priority} />
            <StatusPill status={ticket.status} />
          </div>
          {ticket.description && <p className="text-sm mb-4" style={{ color: "var(--ink)" }}>{ticket.description}</p>}

          <div className="grid grid-cols-2 gap-2 text-xs mb-4" style={{ color: "var(--muted)" }}>
            <div>Requested by: <b style={{ color: "var(--ink)" }}>{nameOf(roster, ticket.requestedBy)}</b></div>
            <div>Assigned to: <b style={{ color: "var(--ink)" }}>{nameOf(roster, ticket.assignedTo)}</b></div>
            <div>Due: <b style={{ color: "var(--ink)" }}>{ticket.dueDate || "—"}</b></div>
            <div>Revisions: <b style={{ color: "var(--ink)" }}>{ticket.revisions.length} ({revEq.toFixed(2)} major-eq.)</b></div>
          </div>

          {isLead && (
            <div className="border-t pt-3 mb-3" style={{ borderColor: "var(--line)" }}>
              <SectionTitle>Assign & status (Team Lead)</SectionTitle>
              <div className="flex flex-wrap gap-2 mt-2">
                <select defaultValue={ticket.assignedTo || ""} onChange={(e) => assign(e.target.value)} className="border rounded px-2 py-1 text-xs" style={{ borderColor: "var(--line)" }}>
                  <option value="">Unassigned</option>
                  {artists.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
                <select value={ticket.status} onChange={(e) => setStatus(e.target.value)} className="border rounded px-2 py-1 text-xs" style={{ borderColor: "var(--line)" }}>
                  {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>
          )}

          {(isAssignee || isLead) && ticket.status !== "Completed" && (
            <div className="border-t pt-3 mb-3" style={{ borderColor: "var(--line)" }}>
              <SectionTitle>Log a revision</SectionTitle>
              <div className="flex gap-2 mt-2">
                <select value={revType} onChange={(e) => setRevType(e.target.value)} className="border rounded px-2 py-1 text-xs" style={{ borderColor: "var(--line)" }}>
                  <option value="minor">Minor</option>
                  <option value="major">Major</option>
                </select>
                <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="What changed?" className="flex-1 border rounded px-2 py-1 text-xs" style={{ borderColor: "var(--line)" }} />
                <button onClick={addRevision} className="px-2 py-1 rounded text-white text-xs font-semibold flex items-center gap-1" style={{ background: "var(--ink)" }}>
                  <MessageSquarePlus size={13} /> Add
                </button>
              </div>
              {!isLead && <div className="text-[11px] mt-1" style={{ color: "var(--muted)" }}>Note: only the Team Lead's tagging counts toward official minor/major stats.</div>}
            </div>
          )}

          {isLead && (
            <div className="border-t pt-3 mb-3" style={{ borderColor: "var(--line)" }}>
              <SectionTitle>Brief compliance (Team Lead rates 1–5)</SectionTitle>
              <StarRow value={comp} onChange={setCompliance} />
            </div>
          )}

          {isRequester && ticket.status !== "Completed" && (
            <div className="border-t pt-3 mb-3" style={{ borderColor: "var(--line)" }}>
              <SectionTitle>Your satisfaction rating (1–5)</SectionTitle>
              <StarRow value={sat} onChange={setSatisfaction} />
              <button
                onClick={complete}
                disabled={!sat}
                className="mt-2 flex items-center gap-1.5 px-3 py-1.5 rounded text-white text-xs font-semibold disabled:opacity-40"
                style={{ background: "var(--teal)" }}
              >
                <CheckCircle2 size={14} /> Approve & complete
              </button>
            </div>
          )}

          {ticket.status === "Completed" && (
            <div className="border-t pt-3 mb-3" style={{ borderColor: "var(--line)" }}>
              <SectionTitle>Accuracy score</SectionTitle>
              <div className="text-2xl font-black mt-1" style={{ fontFamily: "var(--font-display)", color: "var(--teal)" }}>{acc ?? "—"}<span className="text-sm">/100</span></div>
            </div>
          )}

          {ticket.revisions.length > 0 && (
            <div className="border-t pt-3" style={{ borderColor: "var(--line)" }}>
              <SectionTitle>Revision history</SectionTitle>
              <div className="mt-2 space-y-1.5 max-h-32 overflow-y-auto">
                {ticket.revisions.map((r) => (
                  <div key={r.id} className="text-xs">
                    <b className="uppercase" style={{ color: r.type === "major" ? "var(--coral)" : "var(--amber)" }}>{r.type}</b> — {r.note} <span style={{ color: "var(--muted)" }}>({r.taggedBy})</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StarRow({ value, onChange }) {
  return (
    <div className="flex gap-1 mt-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} onClick={() => onChange(n)}>
          <Star size={20} fill={n <= value ? "var(--amber)" : "none"} color="var(--amber)" />
        </button>
      ))}
    </div>
  );
}

function ReportsView({ tickets, roster }) {
  const [month, setMonth] = useState(monthKey(todayISO()));

  const completedInMonth = tickets.filter((t) => t.status === "Completed" && monthKey(t.dateCompleted) === month);

  const perArtist = roster
    .filter((m) => m.role === "Artist" || m.role === "Team Lead")
    .map((m) => {
      const done = completedInMonth.filter((t) => t.assignedTo === m.id);
      const avgRev = done.length ? done.reduce((s, t) => s + revisionEquivalent(t), 0) / done.length : 0;
      const accs = done.map(ticketAccuracy).filter((a) => a !== null);
      const avgAcc = accs.length ? Math.round(accs.reduce((a, b) => a + b, 0) / accs.length) : null;
      return { name: m.name, completed: done.length, avgRev: Number(avgRev.toFixed(2)), avgAcc };
    });

  const orgAccs = completedInMonth.map(ticketAccuracy).filter((a) => a !== null);
  const orgAvgAcc = orgAccs.length ? Math.round(orgAccs.reduce((a, b) => a + b, 0) / orgAccs.length) : null;
  const orgAvgRev = completedInMonth.length ? completedInMonth.reduce((s, t) => s + revisionEquivalent(t), 0) / completedInMonth.length : 0;

  const trend = useMemo(() => {
    const months = [];
    const base = new Date(month + "-01");
    for (let i = 5; i >= 0; i--) {
      const d = new Date(base.getFullYear(), base.getMonth() - i, 1);
      months.push(d.toISOString().slice(0, 7));
    }
    return months.map((mk) => {
      const done = tickets.filter((t) => t.status === "Completed" && monthKey(t.dateCompleted) === mk);
      const accs = done.map(ticketAccuracy).filter((a) => a !== null);
      return {
        month: mk.slice(5),
        accuracy: accs.length ? Math.round(accs.reduce((a, b) => a + b, 0) / accs.length) : null,
        avgRevisions: done.length ? Number((done.reduce((s, t) => s + revisionEquivalent(t), 0) / done.length).toFixed(2)) : null,
      };
    });
  }, [tickets, month]);

  const priorityBreakdown = PRIORITIES.map((p) => ({ name: p, value: tickets.filter((t) => t.priority === p && t.status !== "Completed").length }));

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <SectionTitle>Report month</SectionTitle>
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="border rounded px-2 py-1 text-sm" style={{ borderColor: "var(--line)" }} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Completed this month" value={completedInMonth.length} icon={CheckCircle2} />
        <StatCard label="Org avg accuracy" value={orgAvgAcc ?? "—"} icon={BarChart3} />
        <StatCard label="Org avg revisions" value={orgAvgRev.toFixed(2)} icon={Pencil} />
        <StatCard label="Open priority items" value={tickets.filter((t) => t.status !== "Completed" && (t.priority === "High" || t.priority === "Urgent")).length} icon={Flag} />
      </div>

      <div className="bg-white border rounded-md p-4" style={{ borderColor: "var(--line)" }}>
        <SectionTitle>Per team member — {month}</SectionTitle>
        <table className="w-full text-sm mt-3">
          <thead>
            <tr className="text-left text-xs uppercase" style={{ color: "var(--muted)" }}>
              <th className="pb-2">Name</th>
              <th className="pb-2">Completed</th>
              <th className="pb-2">Avg revisions (major-eq.)</th>
              <th className="pb-2">Avg accuracy</th>
            </tr>
          </thead>
          <tbody>
            {perArtist.map((r) => (
              <tr key={r.name} className="border-t" style={{ borderColor: "var(--line)" }}>
                <td className="py-1.5 font-medium">{r.name}</td>
                <td className="py-1.5">{r.completed}</td>
                <td className="py-1.5">{r.avgRev}</td>
                <td className="py-1.5">{r.avgAcc ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div className="bg-white border rounded-md p-4" style={{ borderColor: "var(--line)" }}>
          <SectionTitle>Completed per member — {month}</SectionTitle>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={perArtist}>
              <CartesianGrid stroke="var(--line)" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-15} textAnchor="end" height={50} />
              <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="completed" fill="var(--amber)" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-white border rounded-md p-4" style={{ borderColor: "var(--line)" }}>
          <SectionTitle>Accuracy & revision trend — last 6 months</SectionTitle>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={trend}>
              <CartesianGrid stroke="var(--line)" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="accuracy" stroke="var(--teal)" strokeWidth={2} dot={false} name="Accuracy" />
              <Line type="monotone" dataKey="avgRevisions" stroke="var(--coral)" strokeWidth={2} dot={false} name="Avg revisions" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="bg-white border rounded-md p-4" style={{ borderColor: "var(--line)" }}>
        <SectionTitle>Open jobs by priority</SectionTitle>
        <ResponsiveContainer width="100%" height={200}>
          <PieChart>
            <Pie data={priorityBreakdown} dataKey="value" nameKey="name" outerRadius={70} label>
              {priorityBreakdown.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
            </Pie>
            <Tooltip />
            <Legend wrapperStyle={{ fontSize: 11 }} />
          </PieChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function TeamView({ roster, saveRoster }) {
  const [name, setName] = useState("");
  const [role, setRole] = useState("Requester");
  const [dept, setDept] = useState("Other");

  const add = (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    saveRoster([...roster, { id: uid(), name, role, dept }]);
    setName("");
  };
  const update = (id, patch) => saveRoster(roster.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  const remove = (id) => saveRoster(roster.filter((m) => m.id !== id));

  return (
    <div className="space-y-5">
      <form onSubmit={add} className="bg-white border rounded-md p-4 flex flex-wrap gap-2 items-end" style={{ borderColor: "var(--line)" }}>
        <Field label="Name">
          <input value={name} onChange={(e) => setName(e.target.value)} className="border rounded px-2 py-1.5 text-sm" style={{ borderColor: "var(--line)" }} />
        </Field>
        <Field label="Role">
          <select value={role} onChange={(e) => setRole(e.target.value)} className="border rounded px-2 py-1.5 text-sm" style={{ borderColor: "var(--line)" }}>
            {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </Field>
        <Field label="Department">
          <select value={dept} onChange={(e) => setDept(e.target.value)} className="border rounded px-2 py-1.5 text-sm" style={{ borderColor: "var(--line)" }}>
            {DEPTS.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </Field>
        <button className="px-3 py-1.5 rounded text-white text-sm font-semibold flex items-center gap-1" style={{ background: "var(--ink)" }}>
          <Plus size={14} /> Add member
        </button>
      </form>

      <div className="bg-white border rounded-md p-4" style={{ borderColor: "var(--line)" }}>
        <SectionTitle>Team roster</SectionTitle>
        <table className="w-full text-sm mt-3">
          <thead>
            <tr className="text-left text-xs uppercase" style={{ color: "var(--muted)" }}>
              <th className="pb-2">Name</th><th className="pb-2">Role</th><th className="pb-2">Dept</th><th className="pb-2"></th>
            </tr>
          </thead>
          <tbody>
            {roster.map((m) => (
              <tr key={m.id} className="border-t" style={{ borderColor: "var(--line)" }}>
                <td className="py-1.5">
                  <input value={m.name} onChange={(e) => update(m.id, { name: e.target.value })} className="border rounded px-1.5 py-0.5 text-sm w-full" style={{ borderColor: "var(--line)" }} />
                </td>
                <td className="py-1.5">
                  <select value={m.role} onChange={(e) => update(m.id, { role: e.target.value })} className="border rounded px-1.5 py-0.5 text-sm" style={{ borderColor: "var(--line)" }}>
                    {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </td>
                <td className="py-1.5">
                  <select value={m.dept} onChange={(e) => update(m.id, { dept: e.target.value })} className="border rounded px-1.5 py-0.5 text-sm" style={{ borderColor: "var(--line)" }}>
                    {DEPTS.map((d) => <option key={d} value={d}>{d}</option>)}
                  </select>
                </td>
                <td className="py-1.5 text-right">
                  <button onClick={() => remove(m.id)}><Trash2 size={15} color="var(--coral)" /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
