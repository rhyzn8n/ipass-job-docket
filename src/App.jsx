import React, { useState, useEffect, useMemo } from "react";
import {
  LayoutDashboard, FilePlus2, KanbanSquare, BarChart3, Users, Flag,
  Clock, CheckCircle2, AlertTriangle, X, Plus, Trash2, Pencil, Send,
  MessageSquarePlus, Star, ChevronRight, Download, Image as ImageIcon, Save
} from "lucide-react";
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, PieChart, Pie, Cell
} from "recharts";
import { storage, ticketsApi } from "./firebase.js";

const STATUSES = ["New", "Assigned", "In Progress", "In Revision", "On Hold", "Review", "Completed", "Cancelled"];
const CLOSED_STATUSES = ["Completed", "Cancelled"];
const PAUSED_STATUSES = ["On Hold", "Completed", "Cancelled"]; // excluded from overdue alerts
const PRIORITIES = ["Low", "Normal", "High", "Urgent"];
const DEPTS = ["Social Media", "SEO", "Other"];
const ROLES = ["Requester", "Artist", "Team Lead", "Admin"];
const CONTENT_TYPES = ["Static", "Video"];
const PURPOSES = ["Ads", "YouTube", "TikTok", "Facebook/IG", "Website", "Other"];

const PRIORITY_COLOR = { Low: "var(--muted)", Normal: "var(--teal)", High: "var(--amber)", Urgent: "var(--coral)" };
const PIE_COLORS = ["var(--amber)", "var(--teal)", "var(--coral)", "var(--muted)", "#7A6FB0", "#4C8FBD"];

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

function nameOf(roster, id) {
  return roster.find((m) => m.id === id)?.name || "Unassigned";
}

// Backward compatible: old tickets have a single `purpose` string,
// new tickets have a `purposes` array (a project can serve several purposes).
function getPurposes(ticket) {
  if (ticket.purposes && ticket.purposes.length) return ticket.purposes;
  if (ticket.purpose) return [ticket.purpose];
  return [];
}

function csvEscape(v) {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function ticketsToCSV(list, roster) {
  const headers = [
    "Ticket No", "Title", "Department", "Content Type", "Purpose(s)", "Requested By", "Assigned To",
    "Priority", "Status", "Date Requested", "Due Date", "Date Completed", "Units",
    "Minor Revisions", "Major Revisions", "Revision Equivalent", "Satisfaction", "Brief Compliance", "Accuracy",
  ];
  const rows = list.map((t) => {
    const minor = t.revisions.filter((r) => r.type === "minor").length;
    const major = t.revisions.filter((r) => r.type === "major").length;
    return [
      t.ticketNo, t.title, t.dept, t.contentType || "", getPurposes(t).join("; "),
      nameOf(roster, t.requestedBy), nameOf(roster, t.assignedTo),
      t.priority, t.status, t.dateRequested, t.dueDate || "", t.dateCompleted || "", t.units || "",
      minor, major, revisionEquivalent(t).toFixed(2),
      t.satisfactionScore || "", t.briefCompliance || "", ticketAccuracy(t) ?? "",
    ].map(csvEscape).join(",");
  });
  return [headers.join(","), ...rows].join("\n");
}

function downloadCSV(csv, filename) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function compressImage(file, maxWidth = 800, quality = 0.7) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxWidth / img.width);
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function saveInspoImage(ticketId, dataUrl) {
  try { await storage.set(`insp_${ticketId}`, dataUrl, true); } catch (e) {}
}
async function loadInspoImage(ticketId) {
  try {
    const res = await storage.get(`insp_${ticketId}`, true);
    return res?.value || null;
  } catch (e) { return null; }
}
async function removeInspoImage(ticketId) {
  try { if (storage.remove) await storage.remove(`insp_${ticketId}`, true); } catch (e) {}
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
    "On Hold": "bg-[var(--muted)]/30 text-[var(--ink)]",
    Review: "bg-[var(--teal)]/20 text-[var(--ink)]",
    Completed: "bg-[var(--teal)] text-[var(--paper)]",
    Cancelled: "bg-[var(--coral)] text-[var(--paper)]",
  };
  return <span className={`px-2 py-0.5 text-[11px] font-semibold rounded ${map[status] || ""}`}>{status}</span>;
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
    let unsubRoster = null;
    let unsubTickets = null;
    let lastKnownUserId = "";

    (async () => {
      try {
        const res = await storage.get("roster", true);
        if (!res || !res.value) await storage.set("roster", JSON.stringify(seedRoster()), true);
      } catch (e) {}

      let seq = 0;
      try {
        const res = await storage.get("ticket_seq", true);
        if (res && res.value) seq = JSON.parse(res.value);
      } catch (e) {}
      setTicketSeq(seq);

      try {
        const res = await storage.get("current_user", false);
        if (res && res.value) lastKnownUserId = res.value;
      } catch (e) {}

      unsubRoster = storage.subscribe("roster", true, (val) => {
        const r = val ? JSON.parse(val) : seedRoster();
        setRoster(r);
        setCurrentUserId((prev) => prev || (lastKnownUserId && r.find((m) => m.id === lastKnownUserId) ? lastKnownUserId : r[0]?.id) || "");
        setReady(true);
      });
      unsubTickets = ticketsApi.subscribe((list) => setTickets(list));
    })();

    return () => {
      if (unsubRoster) unsubRoster();
      if (unsubTickets) unsubTickets();
    };
  }, []);

  const saveRoster = async (next) => {
    setRoster(next);
    try { await storage.set("roster", JSON.stringify(next), true); } catch (e) {}
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

  const updateTicket = async (id, updater) => {
    const current = tickets.find((t) => t.id === id);
    if (!current) return;
    const merged = logHistory(updater({ ...current }), updater.__label || "Updated");
    await ticketsApi.upsert(merged);
  };

  const createTicket = async (data) => {
    const nextSeq = ticketSeq + 1;
    const newId = uid();
    const t = {
      id: newId,
      ticketNo: nextSeq,
      title: data.title,
      description: data.description,
      requesterNotes: data.requesterNotes || "",
      dept: data.dept,
      contentType: data.contentType,
      purposes: data.purposes || [],
      requestedBy: data.requestedBy,
      assignedTo: data.assignedTo || null,
      priority: data.priority,
      status: data.assignedTo ? "Assigned" : "New",
      dateRequested: todayISO(),
      dueDate: data.dueDate || null,
      dateCompleted: null,
      revisions: [],
      revisionRequests: [],
      units: null,
      satisfactionScore: null,
      briefCompliance: null,
      hasImage: !!data.imageDataUrl,
      history: [{ date: new Date().toISOString(), action: "Request logged", by: currentUser?.name || "Unknown" }],
    };
    await ticketsApi.upsert(t);
    await saveSeq(nextSeq);
    if (data.imageDataUrl) await saveInspoImage(newId, data.imageDataUrl);
    setView("board");
  };

  const deleteTicket = async (id) => {
    const t = tickets.find((x) => x.id === id);
    await ticketsApi.remove(id);
    if (t?.hasImage) await removeInspoImage(id);
    setOpenTicketId(null);
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
        {view === "board" && <BoardView tickets={tickets} roster={roster} onOpen={setOpenTicketId} />}
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
          onDelete={deleteTicket}
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
        --paper: #F3F1EA; --ink: #221F26; --amber: #D99A2B; --teal: #2E6B60; --coral: #C6543D;
        --line: #DAD5C7; --muted: #8C8672;
        --font-display: 'Archivo', sans-serif; --font-body: 'IBM Plex Sans', sans-serif; --font-mono: 'IBM Plex Mono', monospace;
      }
      .docket-perf { height: 10px; background-image: radial-gradient(circle, var(--paper) 3.2px, transparent 3.6px); background-size: 14px 100%; background-position: center; }
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
          <h1 className="text-3xl md:text-4xl font-black tracking-tight" style={{ fontFamily: "var(--font-display)" }}>Job Docket</h1>
        </div>
        <label className="text-sm flex items-center gap-2" style={{ color: "var(--muted)" }}>
          Acting as
          <select value={currentUserId} onChange={(e) => pickUser(e.target.value)} className="border rounded px-2 py-1 text-sm bg-white" style={{ borderColor: "var(--line)", fontFamily: "var(--font-mono)", color: "var(--ink)" }}>
            {roster.map((m) => <option key={m.id} value={m.id}>{m.name} — {m.role}</option>)}
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
            <button key={t.id} onClick={() => setView(t.id)} className="flex items-center gap-1.5 px-3 py-3 text-sm font-semibold whitespace-nowrap border-b-2 -mb-px transition-colors" style={{ borderColor: active ? "var(--amber)" : "transparent", color: active ? "var(--ink)" : "var(--muted)" }}>
              <Icon size={15} /> {t.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function TicketCard({ ticket, roster, onOpen }) {
  const overdue = ticket.dueDate && !PAUSED_STATUSES.includes(ticket.status) && ticket.dueDate < todayISO();
  return (
    <button onClick={() => onOpen(ticket.id)} className="text-left w-full bg-white rounded-md shadow-sm border hover:shadow-md transition-shadow" style={{ borderColor: "var(--line)" }}>
      <div className="docket-perf" />
      <div className="p-3">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[11px]" style={{ fontFamily: "var(--font-mono)", color: "var(--muted)" }}>JOB-{String(ticket.ticketNo).padStart(4, "0")}</span>
          <div className="flex items-center gap-1">
            {ticket.hasImage && <ImageIcon size={12} color="var(--muted)" />}
            <StampBadge priority={ticket.priority} />
          </div>
        </div>
        <div className="font-semibold text-sm leading-snug mb-1">{ticket.title}</div>
        <div className="text-xs mb-2" style={{ color: "var(--muted)" }}>
          {ticket.dept} · {ticket.contentType || "—"}{getPurposes(ticket).length ? ` · ${getPurposes(ticket).join(", ")}` : ""} · {nameOf(roster, ticket.assignedTo)}
        </div>
        <div className="flex items-center justify-between">
          <StatusPill status={ticket.status} />
          {overdue && <span className="flex items-center gap-1 text-[11px] font-semibold" style={{ color: "var(--coral)" }}><AlertTriangle size={12} /> overdue</span>}
        </div>
      </div>
    </button>
  );
}

function DashboardView({ tickets, roster, onOpen, setView }) {
  const open = tickets.filter((t) => !CLOSED_STATUSES.includes(t.status));
  const overdue = open.filter((t) => t.dueDate && !PAUSED_STATUSES.includes(t.status) && t.dueDate < todayISO());
  const onHold = tickets.filter((t) => t.status === "On Hold");
  const cancelled = tickets.filter((t) => t.status === "Cancelled");
  const recent = tickets
    .flatMap((t) => t.history.map((h) => ({ ...h, ticket: t })))
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 8);
  const recentlyClosed = tickets
    .filter((t) => CLOSED_STATUSES.includes(t.status))
    .sort((a, b) => new Date(b.history[b.history.length - 1]?.date || 0) - new Date(a.history[a.history.length - 1]?.date || 0))
    .slice(0, 4);

  const members = roster.filter((m) => m.role === "Artist" || m.role === "Team Lead");
  const memberStats = members.map((m) => {
    const mine = tickets.filter((t) => t.assignedTo === m.id);
    return {
      name: m.name,
      ongoing: mine.filter((t) => !CLOSED_STATUSES.includes(t.status)).length,
      completed: mine.filter((t) => t.status === "Completed").length,
      overdue: mine.filter((t) => t.dueDate && !PAUSED_STATUSES.includes(t.status) && t.dueDate < todayISO()).length,
    };
  });
  const overallOngoing = tickets.filter((t) => !CLOSED_STATUSES.includes(t.status)).length;
  const overallCompleted = tickets.filter((t) => t.status === "Completed").length;
  const overallOverdue = tickets.filter((t) => t.dueDate && !PAUSED_STATUSES.includes(t.status) && t.dueDate < todayISO()).length;

  const staticCount = tickets.filter((t) => t.contentType === "Static").length;
  const videoCount = tickets.filter((t) => t.contentType === "Video").length;
  const allPurposeTags = tickets.flatMap((t) => getPurposes(t));
  const byPurpose = PURPOSES.map((p) => ({ name: p, value: allPurposeTags.filter((x) => x === p).length })).filter((p) => p.value > 0);

  const now = new Date();
  const thisMonthKey = now.toISOString().slice(0, 7);
  const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonthKey = lastMonthDate.toISOString().slice(0, 7);
  const unitsInMonth = (mk) => tickets.filter((t) => t.status === "Completed" && monthKey(t.dateCompleted) === mk).reduce((s, t) => s + (t.units || 0), 0);
  const unitsThisMonth = unitsInMonth(thisMonthKey);
  const unitsLastMonth = unitsInMonth(lastMonthKey);
  const unitsPct = unitsLastMonth > 0
    ? Math.round(((unitsThisMonth - unitsLastMonth) / unitsLastMonth) * 100)
    : (unitsThisMonth > 0 ? 100 : 0);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        <StatCard label="Open tickets" value={open.length} icon={KanbanSquare} />
        <StatCard label="Overdue" value={overdue.length} icon={AlertTriangle} alert={overdue.length > 0} />
        <StatCard label="Urgent priority" value={open.filter((t) => t.priority === "Urgent").length} icon={Flag} />
        <StatCard label="On hold" value={onHold.length} icon={Clock} />
        <StatCard label="Cancelled" value={cancelled.length} icon={X} />
        <StatCard label="Units this month" value={unitsThisMonth} icon={Pencil} trendPct={unitsPct} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <StatCard label="Completed total" value={tickets.filter((t) => t.status === "Completed").length} icon={CheckCircle2} />
        <StatCard label="Units last month" value={unitsLastMonth} icon={Pencil} />
        <StatCard label="Units all-time" value={tickets.filter((t) => t.status === "Completed").reduce((s, t) => s + (t.units || 0), 0)} icon={Pencil} />
      </div>

      {recentlyClosed.length > 0 && (
        <div className="bg-white border rounded-md p-4" style={{ borderColor: "var(--line)" }}>
          <SectionTitle>Recently completed / cancelled — click to reopen or review</SectionTitle>
          <div className="grid sm:grid-cols-2 md:grid-cols-4 gap-3 mt-3">
            {recentlyClosed.map((t) => <TicketCard key={t.id} ticket={t} roster={roster} onOpen={onOpen} />)}
          </div>
        </div>
      )}

      <div className="bg-white border rounded-md p-4" style={{ borderColor: "var(--line)" }}>
        <SectionTitle>Ongoing, completed & overdue — per team member</SectionTitle>
        <table className="w-full text-sm mt-3">
          <thead>
            <tr className="text-left text-xs uppercase" style={{ color: "var(--muted)" }}>
              <th className="pb-2">Name</th><th className="pb-2">Ongoing</th><th className="pb-2">Completed</th><th className="pb-2">Overdue</th>
            </tr>
          </thead>
          <tbody>
            {memberStats.map((m) => (
              <tr key={m.name} className="border-t" style={{ borderColor: "var(--line)" }}>
                <td className="py-1.5 font-medium">{m.name}</td>
                <td className="py-1.5">{m.ongoing}</td>
                <td className="py-1.5">{m.completed}</td>
                <td className="py-1.5" style={{ color: m.overdue > 0 ? "var(--coral)" : "var(--ink)" }}>{m.overdue}</td>
              </tr>
            ))}
            <tr className="border-t-2 font-bold" style={{ borderColor: "var(--ink)" }}>
              <td className="py-1.5">Overall</td>
              <td className="py-1.5">{overallOngoing}</td>
              <td className="py-1.5">{overallCompleted}</td>
              <td className="py-1.5" style={{ color: overallOverdue > 0 ? "var(--coral)" : "var(--ink)" }}>{overallOverdue}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <RequestsPanel tickets={tickets} roster={roster} onOpen={onOpen} />

      <div className="bg-white border rounded-md p-4" style={{ borderColor: "var(--line)" }}>
        <SectionTitle>Recent activity</SectionTitle>
        <div className="mt-3 grid sm:grid-cols-2 gap-x-6">
          {recent.length === 0 && <EmptyState text="No activity yet." />}
          {recent.map((h, i) => (
              <div key={i} className="text-xs">
                <div className="font-semibold">{h.action}</div>
                <div style={{ color: "var(--muted)" }}>JOB-{String(h.ticket.ticketNo).padStart(4, "0")} · {h.by} · {new Date(h.date).toLocaleDateString()}</div>
              </div>
            ))}
          </div>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div className="bg-white border rounded-md p-4" style={{ borderColor: "var(--line)" }}>
          <SectionTitle>Content type mix (all-time)</SectionTitle>
          <div className="flex gap-4 mt-3">
            <StatCard label="Static" value={staticCount} icon={ImageIcon} />
            <StatCard label="Video" value={videoCount} icon={ImageIcon} />
          </div>
        </div>
        <div className="bg-white border rounded-md p-4" style={{ borderColor: "var(--line)" }}>
          <SectionTitle>Requests by purpose</SectionTitle>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={byPurpose}>
              <CartesianGrid stroke="var(--line)" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="value" fill="var(--teal)" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

function RequestsPanel({ tickets, roster, onOpen }) {
  const [tab, setTab] = useState("overdue");
  const today = todayISO();

  const groups = {
    overdue: tickets.filter((t) => t.dueDate && !PAUSED_STATUSES.includes(t.status) && t.dueDate < today),
    ongoing: tickets.filter((t) => !CLOSED_STATUSES.includes(t.status) && t.status !== "On Hold"),
    onhold: tickets.filter((t) => t.status === "On Hold"),
    completed: tickets.filter((t) => t.status === "Completed"),
    cancelled: tickets.filter((t) => t.status === "Cancelled"),
    all: tickets,
  };
  const tabs = [
    { id: "overdue", label: "Overdue" },
    { id: "ongoing", label: "Ongoing" },
    { id: "onhold", label: "On Hold" },
    { id: "completed", label: "Completed" },
    { id: "cancelled", label: "Cancelled" },
    { id: "all", label: "All" },
  ];
  const list = groups[tab];

  return (
    <div className="bg-white border rounded-md p-4" style={{ borderColor: "var(--line)" }}>
      <SectionTitle>Requests</SectionTitle>
      <div className="flex flex-wrap gap-1 mt-2 mb-3">
        {tabs.map((tb) => (
          <button
            key={tb.id}
            onClick={() => setTab(tb.id)}
            className="px-2.5 py-1 text-xs font-semibold rounded"
            style={{ background: tab === tb.id ? "var(--ink)" : "var(--paper)", color: tab === tb.id ? "white" : "var(--muted)" }}
          >
            {tb.label} ({groups[tb.id].length})
          </button>
        ))}
      </div>
      {list.length === 0 ? (
        <EmptyState text="Nothing here." />
      ) : (
        <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-3 max-h-[420px] overflow-y-auto pr-1">
          {list.map((t) => <TicketCard key={t.id} ticket={t} roster={roster} onOpen={onOpen} />)}
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, icon: Icon, alert, trendPct }) {
  const hasTrend = trendPct !== undefined && trendPct !== null;
  const up = hasTrend && trendPct >= 0;
  return (
    <div className="bg-white border rounded-md p-3 flex-1" style={{ borderColor: alert ? "var(--coral)" : "var(--line)" }}>
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider" style={{ color: "var(--muted)" }}><Icon size={13} /> {label}</div>
      <div className="flex items-baseline gap-2 mt-1">
        <div className="text-2xl font-black" style={{ fontFamily: "var(--font-display)", color: alert ? "var(--coral)" : "var(--ink)" }}>{value}</div>
        {hasTrend && (
          <span className="text-[11px] font-semibold" style={{ color: up ? "var(--teal)" : "var(--coral)" }}>
            {up ? "▲" : "▼"} {Math.abs(trendPct)}% vs last month
          </span>
        )}
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
  const [requesterNotes, setRequesterNotes] = useState("");
  const [dept, setDept] = useState(currentUser?.dept || "Social Media");
  const [contentType, setContentType] = useState("Static");
  const [purposes, setPurposes] = useState(["Ads"]);
  const [requestedBy, setRequestedBy] = useState(currentUser?.id || "");
  const [assignedTo, setAssignedTo] = useState("");
  const [priority, setPriority] = useState("Normal");
  const [dueDate, setDueDate] = useState("");
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirm, setConfirm] = useState(false);

  const artists = roster.filter((m) => m.role === "Artist" || m.role === "Team Lead");

  const togglePurpose = (p) => {
    setPurposes((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));
  };

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImageFile(file);
    const compressed = await compressImage(file);
    setImagePreview(compressed);
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!title.trim() || !requestedBy) return;
    setSubmitting(true);
    await onCreate({ title, description, requesterNotes, dept, contentType, purposes, requestedBy, assignedTo, priority, dueDate, imageDataUrl: imagePreview });
    setTitle(""); setDescription(""); setRequesterNotes(""); setAssignedTo(""); setDueDate(""); setPriority("Normal");
    setImageFile(null); setImagePreview(null);
    setSubmitting(false);
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
      <Field label="Additional notes (optional)">
        <textarea value={requesterNotes} onChange={(e) => setRequesterNotes(e.target.value)} rows={2} className="w-full border rounded px-3 py-2 text-sm" style={{ borderColor: "var(--line)" }} placeholder="Anything specific worth flagging separately from the brief…" />
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
        <Field label="Content type">
          <select value={contentType} onChange={(e) => setContentType(e.target.value)} className="w-full border rounded px-3 py-2 text-sm" style={{ borderColor: "var(--line)" }}>
            {CONTENT_TYPES.map((c) => <option key={c} value={c}>{c}</option>)}
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
      <Field label="Purpose (select all that apply)">
        <div className="flex flex-wrap gap-3 mt-1">
          {PURPOSES.map((p) => (
            <label key={p} className="flex items-center gap-1.5 text-sm normal-case font-normal" style={{ color: "var(--ink)" }}>
              <input type="checkbox" checked={purposes.includes(p)} onChange={() => togglePurpose(p)} />
              {p}
            </label>
          ))}
        </div>
      </Field>
      <Field label="Assign to (optional — can be assigned later on the Board)">
        <select value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} className="w-full border rounded px-3 py-2 text-sm" style={{ borderColor: "var(--line)" }}>
          <option value="">— Unassigned —</option>
          {artists.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
      </Field>
      <Field label="Inspiration image (optional)">
        <input type="file" accept="image/*" onChange={handleFile} className="text-sm" />
        {imagePreview && <img src={imagePreview} alt="preview" className="mt-2 max-h-32 rounded border" style={{ borderColor: "var(--line)" }} />}
      </Field>
      <button type="submit" disabled={submitting} className="flex items-center gap-2 px-4 py-2 rounded font-semibold text-sm text-white disabled:opacity-50" style={{ background: "var(--ink)" }}>
        <Send size={14} /> {submitting ? "Logging…" : "Log request"}
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
  const filtered = tickets.filter((t) => (!filterAssignee || t.assignedTo === filterAssignee) && (!filterPriority || t.priority === filterPriority));
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
              {filtered.filter((t) => t.status === s).map((t) => <TicketCard key={t.id} ticket={t} roster={roster} onOpen={onOpen} />)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TicketModal({ ticket, roster, currentUser, isLead, onClose, onUpdate, onDelete }) {
  const [note, setNote] = useState("");
  const [revType, setRevType] = useState("minor");
  const [sat, setSat] = useState(ticket.satisfactionScore || 0);
  const [comp, setComp] = useState(ticket.briefCompliance || 0);
  const [editing, setEditing] = useState(false);
  const [imageUrl, setImageUrl] = useState(null);
  const [revisionPoint, setRevisionPoint] = useState("");
  const [unitsInput, setUnitsInput] = useState(ticket.units || "");

  const [eTitle, setETitle] = useState(ticket.title);
  const [eDesc, setEDesc] = useState(ticket.description);
  const [eNotes, setENotes] = useState(ticket.requesterNotes || "");
  const [eDept, setEDept] = useState(ticket.dept);
  const [eContentType, setEContentType] = useState(ticket.contentType || "Static");
  const [ePurposes, setEPurposes] = useState(getPurposes(ticket));
  const [ePriority, setEPriority] = useState(ticket.priority);
  const [eDue, setEDue] = useState(ticket.dueDate || "");

  useEffect(() => {
    if (ticket.hasImage) loadInspoImage(ticket.id).then(setImageUrl);
  }, [ticket.id, ticket.hasImage]);

  const artists = roster.filter((m) => m.role === "Artist" || m.role === "Team Lead");
  const isAssignee = ticket.assignedTo === currentUser?.id;
  const isRequester = ticket.requestedBy === currentUser?.id;
  const canEdit = isLead || isRequester;
  const revEq = revisionEquivalent(ticket);
  const acc = ticketAccuracy(ticket);
  const toggleEPurpose = (p) => setEPurposes((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));

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
  const addRevisionPoint = () => {
    if (!revisionPoint.trim()) return;
    onUpdate(ticket.id, Object.assign(
      (t) => ({ ...t, revisionRequests: [...(t.revisionRequests || []), { id: uid(), note: revisionPoint, by: currentUser?.name, date: new Date().toISOString() }] }),
      { __label: "Revision point noted by requester" }
    ));
    setRevisionPoint("");
  };
  const saveUnits = () => {
    const n = Number(unitsInput);
    if (!unitsInput || isNaN(n) || n <= 0) return;
    onUpdate(ticket.id, Object.assign((t) => ({ ...t, units: n }), { __label: `Units set to ${n}` }));
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
  const reopen = () => {
    const wasCompleted = ticket.status === "Completed";
    const nextStatus = wasCompleted ? "Review" : ticket.assignedTo ? "Assigned" : "New";
    const msg = wasCompleted
      ? "Reopen this ticket? It will move back to Review and drop out of completed stats until re-approved."
      : "Reopen this cancelled ticket? It will move back into active work.";
    if (!window.confirm(msg)) return;
    onUpdate(ticket.id, Object.assign(
      (t) => ({ ...t, status: nextStatus, dateCompleted: null }),
      { __label: wasCompleted ? "Reopened — marked complete by mistake" : "Reopened from Cancelled" }
    ));
  };
  const saveEdits = () => {
    const changes = [];
    if (eTitle !== ticket.title) changes.push(`title "${ticket.title}" → "${eTitle}"`);
    if (eDesc !== ticket.description) changes.push(`description updated`);
    if (eNotes !== (ticket.requesterNotes || "")) changes.push(`notes updated`);
    if (eDept !== ticket.dept) changes.push(`department ${ticket.dept} → ${eDept}`);
    if (eContentType !== ticket.contentType) changes.push(`content type ${ticket.contentType || "—"} → ${eContentType}`);
    const oldPurposes = getPurposes(ticket);
    if (JSON.stringify([...ePurposes].sort()) !== JSON.stringify([...oldPurposes].sort())) changes.push(`purposes ${oldPurposes.join(", ") || "—"} → ${ePurposes.join(", ") || "—"}`);
    if (ePriority !== ticket.priority) changes.push(`priority ${ticket.priority} → ${ePriority}`);
    if (eDue !== (ticket.dueDate || "")) changes.push(`due date ${ticket.dueDate || "—"} → ${eDue || "—"}`);
    if (changes.length === 0) { setEditing(false); return; }
    onUpdate(ticket.id, Object.assign(
      (t) => ({ ...t, title: eTitle, description: eDesc, requesterNotes: eNotes, dept: eDept, contentType: eContentType, purposes: ePurposes, priority: ePriority, dueDate: eDue || null }),
      { __label: `Edited: ${changes.join("; ")}` }
    ));
    setEditing(false);
  };
  const handleDelete = () => {
    if (window.confirm(`Delete JOB-${String(ticket.ticketNo).padStart(4, "0")}? This cannot be undone.`)) onDelete(ticket.id);
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-start md:items-center justify-center z-50 p-3 overflow-y-auto" onClick={onClose}>
      <div className="bg-white rounded-md max-w-xl w-full my-6" style={{ fontFamily: "var(--font-body)" }} onClick={(e) => e.stopPropagation()}>
        <div className="docket-perf" />
        <div className="p-5">
          <div className="flex items-start justify-between mb-2">
            <div className="flex-1">
              <div className="text-[11px]" style={{ fontFamily: "var(--font-mono)", color: "var(--muted)" }}>
                JOB-{String(ticket.ticketNo).padStart(4, "0")} · {ticket.dept}
              </div>
              {!editing ? (
                <h2 className="text-xl font-black" style={{ fontFamily: "var(--font-display)" }}>{ticket.title}</h2>
              ) : (
                <input value={eTitle} onChange={(e) => setETitle(e.target.value)} className="text-xl font-black border rounded px-2 py-1 w-full mt-1" style={{ fontFamily: "var(--font-display)", borderColor: "var(--line)" }} />
              )}
            </div>
            <div className="flex items-center gap-2 ml-2">
              {canEdit && !editing && <button onClick={() => setEditing(true)} title="Edit details"><Pencil size={16} color="var(--muted)" /></button>}
              {isLead && <button onClick={handleDelete} title="Delete request"><Trash2 size={16} color="var(--coral)" /></button>}
              <button onClick={onClose}><X size={18} /></button>
            </div>
          </div>

          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <StampBadge priority={editing ? ePriority : ticket.priority} />
            <StatusPill status={ticket.status} />
            {!editing && ticket.contentType && <span className="text-[11px] px-2 py-0.5 rounded border" style={{ borderColor: "var(--line)", color: "var(--muted)" }}>{ticket.contentType}</span>}
            {!editing && getPurposes(ticket).map((p) => (
              <span key={p} className="text-[11px] px-2 py-0.5 rounded border" style={{ borderColor: "var(--line)", color: "var(--muted)" }}>{p}</span>
            ))}
          </div>

          {!editing ? (
            <>
              {ticket.description && <p className="text-sm mb-2">{ticket.description}</p>}
              {ticket.requesterNotes && (
                <div className="text-sm mb-4 p-2 rounded" style={{ background: "var(--paper)" }}>
                  <span className="text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--muted)" }}>Requester notes: </span>
                  {ticket.requesterNotes}
                </div>
              )}
            </>
          ) : (
            <div className="space-y-3 mb-4 p-3 rounded border" style={{ borderColor: "var(--line)" }}>
              <Field label="Description">
                <textarea value={eDesc} onChange={(e) => setEDesc(e.target.value)} rows={3} className="w-full border rounded px-2 py-1.5 text-sm" style={{ borderColor: "var(--line)" }} />
              </Field>
              <Field label="Requester notes">
                <textarea value={eNotes} onChange={(e) => setENotes(e.target.value)} rows={2} className="w-full border rounded px-2 py-1.5 text-sm" style={{ borderColor: "var(--line)" }} />
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Department">
                  <select value={eDept} onChange={(e) => setEDept(e.target.value)} className="w-full border rounded px-2 py-1.5 text-sm" style={{ borderColor: "var(--line)" }}>
                    {DEPTS.map((d) => <option key={d} value={d}>{d}</option>)}
                  </select>
                </Field>
                <Field label="Priority">
                  <select value={ePriority} onChange={(e) => setEPriority(e.target.value)} className="w-full border rounded px-2 py-1.5 text-sm" style={{ borderColor: "var(--line)" }}>
                    {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </Field>
                <Field label="Content type">
                  <select value={eContentType} onChange={(e) => setEContentType(e.target.value)} className="w-full border rounded px-2 py-1.5 text-sm" style={{ borderColor: "var(--line)" }}>
                    {CONTENT_TYPES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </Field>
                <Field label="Due date">
                  <input type="date" value={eDue} onChange={(e) => setEDue(e.target.value)} className="w-full border rounded px-2 py-1.5 text-sm" style={{ borderColor: "var(--line)" }} />
                </Field>
              </div>
              <Field label="Purpose (select all that apply)">
                <div className="flex flex-wrap gap-3 mt-1">
                  {PURPOSES.map((p) => (
                    <label key={p} className="flex items-center gap-1.5 text-sm normal-case font-normal" style={{ color: "var(--ink)" }}>
                      <input type="checkbox" checked={ePurposes.includes(p)} onChange={() => toggleEPurpose(p)} />
                      {p}
                    </label>
                  ))}
                </div>
              </Field>
              <div className="flex gap-2">
                <button onClick={saveEdits} className="flex items-center gap-1 px-3 py-1.5 rounded text-white text-xs font-semibold" style={{ background: "var(--ink)" }}><Save size={13} /> Save changes</button>
                <button onClick={() => setEditing(false)} className="px-3 py-1.5 rounded text-xs font-semibold border" style={{ borderColor: "var(--line)" }}>Cancel</button>
              </div>
            </div>
          )}

          {imageUrl && (
            <div className="mb-4">
              <SectionTitle>Inspiration image</SectionTitle>
              <img src={imageUrl} alt="inspiration" className="mt-2 max-h-56 rounded border" style={{ borderColor: "var(--line)" }} />
            </div>
          )}

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

          {(isAssignee || isLead) && !CLOSED_STATUSES.includes(ticket.status) && (
            <div className="border-t pt-3 mb-3" style={{ borderColor: "var(--line)" }}>
              <SectionTitle>Log a revision</SectionTitle>
              <div className="flex gap-2 mt-2">
                <select value={revType} onChange={(e) => setRevType(e.target.value)} className="border rounded px-2 py-1 text-xs" style={{ borderColor: "var(--line)" }}>
                  <option value="minor">Minor</option>
                  <option value="major">Major</option>
                </select>
                <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="What changed?" className="flex-1 border rounded px-2 py-1 text-xs" style={{ borderColor: "var(--line)" }} />
                <button onClick={addRevision} className="px-2 py-1 rounded text-white text-xs font-semibold flex items-center gap-1" style={{ background: "var(--ink)" }}><MessageSquarePlus size={13} /> Add</button>
              </div>
              {!isLead && <div className="text-[11px] mt-1" style={{ color: "var(--muted)" }}>Note: only the Team Lead's tagging counts toward official minor/major stats.</div>}
            </div>
          )}

          {(ticket.revisionRequests || []).length > 0 && (
            <div className="border-t pt-3 mb-3" style={{ borderColor: "var(--line)" }}>
              <SectionTitle>Revision points from requester</SectionTitle>
              <div className="mt-2 space-y-1.5 max-h-32 overflow-y-auto">
                {ticket.revisionRequests.map((r) => (
                  <div key={r.id} className="text-xs">{r.note} <span style={{ color: "var(--muted)" }}>— {r.by}, {new Date(r.date).toLocaleDateString()}</span></div>
                ))}
              </div>
            </div>
          )}

          {isRequester && !CLOSED_STATUSES.includes(ticket.status) && (
            <div className="border-t pt-3 mb-3" style={{ borderColor: "var(--line)" }}>
              <SectionTitle>Note a revision point</SectionTitle>
              <div className="flex gap-2 mt-2">
                <input value={revisionPoint} onChange={(e) => setRevisionPoint(e.target.value)} placeholder="What needs to change?" className="flex-1 border rounded px-2 py-1 text-xs" style={{ borderColor: "var(--line)" }} />
                <button onClick={addRevisionPoint} className="px-2 py-1 rounded text-white text-xs font-semibold flex items-center gap-1" style={{ background: "var(--ink)" }}><MessageSquarePlus size={13} /> Add</button>
              </div>
            </div>
          )}

          {isLead && (
            <div className="border-t pt-3 mb-3" style={{ borderColor: "var(--line)" }}>
              <SectionTitle>Brief compliance (Team Lead rates 1–5)</SectionTitle>
              <StarRow value={comp} onChange={setCompliance} />
            </div>
          )}

          {isRequester && !CLOSED_STATUSES.includes(ticket.status) && (
            <div className="border-t pt-3 mb-3" style={{ borderColor: "var(--line)" }}>
              <SectionTitle>Your satisfaction rating (1–5)</SectionTitle>
              <StarRow value={sat} onChange={setSatisfaction} />
              <div className="text-[11px] mt-1" style={{ color: "var(--muted)" }}>Marking the project complete is done by the Team Lead/Admin, using this rating as one input.</div>
            </div>
          )}

          {isLead && !CLOSED_STATUSES.includes(ticket.status) && (
            <div className="border-t pt-3 mb-3" style={{ borderColor: "var(--line)" }}>
              <SectionTitle>Units produced (Team Lead) — 1 project can count as multiple units</SectionTitle>
              <div className="flex gap-2 mt-2 items-center">
                <input type="number" min="1" value={unitsInput} onChange={(e) => setUnitsInput(e.target.value)} className="w-20 border rounded px-2 py-1 text-xs" style={{ borderColor: "var(--line)" }} />
                <button onClick={saveUnits} className="px-2 py-1 rounded text-white text-xs font-semibold" style={{ background: "var(--ink)" }}>Save units</button>
                {ticket.units && <span className="text-xs" style={{ color: "var(--muted)" }}>Currently: {ticket.units}</span>}
              </div>
              <button
                onClick={complete}
                disabled={!ticket.units}
                title={!ticket.units ? "Set units produced before marking complete" : ""}
                className="mt-3 flex items-center gap-1.5 px-3 py-1.5 rounded text-white text-xs font-semibold disabled:opacity-40"
                style={{ background: "var(--teal)" }}
              >
                <CheckCircle2 size={14} /> Mark as Completed
              </button>
            </div>
          )}

          {ticket.status === "Completed" && (
            <div className="border-t pt-3 mb-3" style={{ borderColor: "var(--line)" }}>
              <SectionTitle>Accuracy score</SectionTitle>
              <div className="text-2xl font-black mt-1" style={{ fontFamily: "var(--font-display)", color: "var(--teal)" }}>{acc ?? "—"}<span className="text-sm">/100</span></div>
              {ticket.units && <div className="text-xs mt-1" style={{ color: "var(--muted)" }}>Units produced: {ticket.units}</div>}
              {isLead && (
                <div className="flex gap-2 items-center mt-2">
                  <input type="number" min="1" value={unitsInput} onChange={(e) => setUnitsInput(e.target.value)} className="w-20 border rounded px-2 py-1 text-xs" style={{ borderColor: "var(--line)" }} />
                  <button onClick={saveUnits} className="px-2 py-1 rounded text-xs font-semibold border" style={{ borderColor: "var(--line)" }}>Correct units</button>
                </div>
              )}
              {isLead && (
                <button onClick={reopen} className="mt-2 flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold border" style={{ borderColor: "var(--coral)", color: "var(--coral)" }}>
                  <AlertTriangle size={13} /> Reopen (mark as mistake)
                </button>
              )}
            </div>
          )}

          {ticket.status === "Cancelled" && isLead && (
            <div className="border-t pt-3 mb-3" style={{ borderColor: "var(--line)" }}>
              <button onClick={reopen} className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold border" style={{ borderColor: "var(--coral)", color: "var(--coral)" }}>
                <AlertTriangle size={13} /> Reopen cancelled ticket
              </button>
            </div>
          )}

          {ticket.revisions.length > 0 && (
            <div className="border-t pt-3 mb-3" style={{ borderColor: "var(--line)" }}>
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

          <div className="border-t pt-3" style={{ borderColor: "var(--line)" }}>
            <SectionTitle>Edit / change log</SectionTitle>
            <div className="mt-2 space-y-1.5 max-h-40 overflow-y-auto">
              {[...ticket.history].reverse().map((h, i) => (
                <div key={i} className="text-xs">
                  <span style={{ color: "var(--muted)" }}>{new Date(h.date).toLocaleString()} · {h.by}</span> — {h.action}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function StarRow({ value, onChange }) {
  return (
    <div className="flex gap-1 mt-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} onClick={() => onChange(n)}><Star size={20} fill={n <= value ? "var(--amber)" : "none"} color="var(--amber)" /></button>
      ))}
    </div>
  );
}

function ReportsView({ tickets, roster }) {
  const [reportTab, setReportTab] = useState("completed"); // "completed" | "ongoing"
  const [periodType, setPeriodType] = useState("monthly"); // "monthly" | "daily"
  const [month, setMonth] = useState(monthKey(todayISO()));
  const [day, setDay] = useState(todayISO());

  const periodLabel = periodType === "monthly" ? month : day;
  const completedInPeriod = tickets.filter((t) => {
    if (t.status !== "Completed") return false;
    return periodType === "monthly" ? monthKey(t.dateCompleted) === month : t.dateCompleted === day;
  });
  const requestedInPeriod = tickets.filter((t) => {
    return periodType === "monthly" ? monthKey(t.dateRequested) === month : t.dateRequested === day;
  });

  const perArtist = roster
    .filter((m) => m.role === "Artist" || m.role === "Team Lead")
    .map((m) => {
      const done = completedInPeriod.filter((t) => t.assignedTo === m.id);
      const avgRev = done.length ? done.reduce((s, t) => s + revisionEquivalent(t), 0) / done.length : 0;
      const accs = done.map(ticketAccuracy).filter((a) => a !== null);
      const avgAcc = accs.length ? Math.round(accs.reduce((a, b) => a + b, 0) / accs.length) : null;
      const totalUnits = done.reduce((s, t) => s + (t.units || 0), 0);
      return { name: m.name, completed: done.length, avgRev: Number(avgRev.toFixed(2)), avgAcc, totalUnits };
    });

  const orgAccs = completedInPeriod.map(ticketAccuracy).filter((a) => a !== null);
  const orgAvgAcc = orgAccs.length ? Math.round(orgAccs.reduce((a, b) => a + b, 0) / orgAccs.length) : null;
  const orgAvgRev = completedInPeriod.length ? completedInPeriod.reduce((s, t) => s + revisionEquivalent(t), 0) / completedInPeriod.length : 0;
  const orgTotalUnits = completedInPeriod.reduce((s, t) => s + (t.units || 0), 0);

  const ongoingByArtist = roster
    .filter((m) => m.role === "Artist" || m.role === "Team Lead")
    .map((m) => {
      const mine = tickets.filter((t) => t.assignedTo === m.id && !CLOSED_STATUSES.includes(t.status));
      return {
        name: m.name,
        total: mine.length,
        overdue: mine.filter((t) => t.dueDate && t.status !== "On Hold" && t.dueDate < todayISO()).length,
        onHold: mine.filter((t) => t.status === "On Hold").length,
      };
    });
  const overallOngoing = tickets.filter((t) => !CLOSED_STATUSES.includes(t.status));

  const trend = useMemo(() => {
    if (periodType === "monthly") {
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
          label: mk.slice(5),
          completed: done.length,
          accuracy: accs.length ? Math.round(accs.reduce((a, b) => a + b, 0) / accs.length) : null,
          avgRevisions: done.length ? Number((done.reduce((s, t) => s + revisionEquivalent(t), 0) / done.length).toFixed(2)) : null,
        };
      });
    }
    const days = [];
    const base = new Date(day + "T00:00:00");
    for (let i = 13; i >= 0; i--) {
      const d = new Date(base);
      d.setDate(base.getDate() - i);
      days.push(d.toISOString().slice(0, 10));
    }
    return days.map((dk) => {
      const done = tickets.filter((t) => t.status === "Completed" && t.dateCompleted === dk);
      const accs = done.map(ticketAccuracy).filter((a) => a !== null);
      return {
        label: dk.slice(5),
        completed: done.length,
        accuracy: accs.length ? Math.round(accs.reduce((a, b) => a + b, 0) / accs.length) : null,
        avgRevisions: done.length ? Number((done.reduce((s, t) => s + revisionEquivalent(t), 0) / done.length).toFixed(2)) : null,
      };
    });
  }, [tickets, month, day, periodType]);

  const priorityBreakdown = PRIORITIES.map((p) => ({ name: p, value: tickets.filter((t) => t.priority === p && t.status !== "Completed").length }));

  return (
    <div className="space-y-6">
      <div className="flex border rounded overflow-hidden w-fit" style={{ borderColor: "var(--line)" }}>
        <button onClick={() => setReportTab("completed")} className="px-4 py-1.5 text-xs font-semibold" style={{ background: reportTab === "completed" ? "var(--ink)" : "white", color: reportTab === "completed" ? "white" : "var(--ink)" }}>Completed Report</button>
        <button onClick={() => setReportTab("ongoing")} className="px-4 py-1.5 text-xs font-semibold" style={{ background: reportTab === "ongoing" ? "var(--ink)" : "white", color: reportTab === "ongoing" ? "white" : "var(--ink)" }}>Ongoing Projects</button>
      </div>

      {reportTab === "ongoing" ? (
        <div className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <StatCard label="Ongoing (overall)" value={overallOngoing.length} icon={KanbanSquare} />
            <StatCard label="Overdue (overall)" value={overallOngoing.filter((t) => t.dueDate && t.status !== "On Hold" && t.dueDate < todayISO()).length} icon={AlertTriangle} />
            <StatCard label="On hold (overall)" value={overallOngoing.filter((t) => t.status === "On Hold").length} icon={Clock} />
          </div>
          <div className="bg-white border rounded-md p-4" style={{ borderColor: "var(--line)" }}>
            <SectionTitle>Ongoing projects — per team member</SectionTitle>
            <table className="w-full text-sm mt-3">
              <thead>
                <tr className="text-left text-xs uppercase" style={{ color: "var(--muted)" }}>
                  <th className="pb-2">Name</th><th className="pb-2">Ongoing</th><th className="pb-2">Overdue</th><th className="pb-2">On Hold</th>
                </tr>
              </thead>
              <tbody>
                {ongoingByArtist.map((r) => (
                  <tr key={r.name} className="border-t" style={{ borderColor: "var(--line)" }}>
                    <td className="py-1.5 font-medium">{r.name}</td>
                    <td className="py-1.5">{r.total}</td>
                    <td className="py-1.5" style={{ color: r.overdue > 0 ? "var(--coral)" : "var(--ink)" }}>{r.overdue}</td>
                    <td className="py-1.5">{r.onHold}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
      <>
      <div className="flex flex-wrap items-center gap-3">
        <SectionTitle>Report period</SectionTitle>
        <div className="flex border rounded overflow-hidden" style={{ borderColor: "var(--line)" }}>
          <button onClick={() => setPeriodType("monthly")} className="px-3 py-1 text-xs font-semibold" style={{ background: periodType === "monthly" ? "var(--ink)" : "white", color: periodType === "monthly" ? "white" : "var(--ink)" }}>Monthly</button>
          <button onClick={() => setPeriodType("daily")} className="px-3 py-1 text-xs font-semibold" style={{ background: periodType === "daily" ? "var(--ink)" : "white", color: periodType === "daily" ? "white" : "var(--ink)" }}>Daily</button>
        </div>
        {periodType === "monthly" ? (
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="border rounded px-2 py-1 text-sm" style={{ borderColor: "var(--line)" }} />
        ) : (
          <input type="date" value={day} onChange={(e) => setDay(e.target.value)} className="border rounded px-2 py-1 text-sm" style={{ borderColor: "var(--line)" }} />
        )}
        <button onClick={() => downloadCSV(ticketsToCSV(completedInPeriod, roster), `job-docket-report-${periodLabel}.csv`)} className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold border" style={{ borderColor: "var(--line)" }}>
          <Download size={13} /> Export {periodLabel} CSV
        </button>
        <button onClick={() => downloadCSV(ticketsToCSV(tickets, roster), `job-docket-all-data.csv`)} className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold border" style={{ borderColor: "var(--line)" }}>
          <Download size={13} /> Export all data CSV
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        <StatCard label="Requests logged" value={requestedInPeriod.length} icon={FilePlus2} />
        <StatCard label="Completed" value={completedInPeriod.length} icon={CheckCircle2} />
        <StatCard label="Units produced" value={orgTotalUnits} icon={Pencil} />
        <StatCard label="Avg accuracy" value={orgAvgAcc ?? "—"} icon={BarChart3} />
        <StatCard label="Avg revisions" value={orgAvgRev.toFixed(2)} icon={Pencil} />
        <StatCard label="Open priority items" value={tickets.filter((t) => t.status !== "Completed" && (t.priority === "High" || t.priority === "Urgent")).length} icon={Flag} />
      </div>

      <div className="bg-white border rounded-md p-4" style={{ borderColor: "var(--line)" }}>
        <SectionTitle>Per team member — {periodLabel}</SectionTitle>
        <table className="w-full text-sm mt-3">
          <thead>
            <tr className="text-left text-xs uppercase" style={{ color: "var(--muted)" }}>
              <th className="pb-2">Name</th><th className="pb-2">Completed</th><th className="pb-2">Units</th><th className="pb-2">Avg revisions (major-eq.)</th><th className="pb-2">Avg accuracy</th>
            </tr>
          </thead>
          <tbody>
            {perArtist.map((r) => (
              <tr key={r.name} className="border-t" style={{ borderColor: "var(--line)" }}>
                <td className="py-1.5 font-medium">{r.name}</td>
                <td className="py-1.5">{r.completed}</td>
                <td className="py-1.5">{r.totalUnits}</td>
                <td className="py-1.5">{r.avgRev}</td>
                <td className="py-1.5">{r.avgAcc ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div className="bg-white border rounded-md p-4" style={{ borderColor: "var(--line)" }}>
          <SectionTitle>Completed per member — {periodLabel}</SectionTitle>
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
          <SectionTitle>{periodType === "monthly" ? "Last 6 months" : "Last 14 days"} — accuracy & revisions</SectionTitle>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={trend}>
              <CartesianGrid stroke="var(--line)" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={periodType === "daily" ? 1 : 0} angle={periodType === "daily" ? -35 : 0} textAnchor={periodType === "daily" ? "end" : "middle"} height={periodType === "daily" ? 45 : 30} />
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
      </>
      )}
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
        <Field label="Name"><input value={name} onChange={(e) => setName(e.target.value)} className="border rounded px-2 py-1.5 text-sm" style={{ borderColor: "var(--line)" }} /></Field>
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
        <button className="px-3 py-1.5 rounded text-white text-sm font-semibold flex items-center gap-1" style={{ background: "var(--ink)" }}><Plus size={14} /> Add member</button>
      </form>

      <div className="bg-white border rounded-md p-4" style={{ borderColor: "var(--line)" }}>
        <SectionTitle>Team roster</SectionTitle>
        <table className="w-full text-sm mt-3">
          <thead>
            <tr className="text-left text-xs uppercase" style={{ color: "var(--muted)" }}><th className="pb-2">Name</th><th className="pb-2">Role</th><th className="pb-2">Dept</th><th className="pb-2"></th></tr>
          </thead>
          <tbody>
            {roster.map((m) => (
              <tr key={m.id} className="border-t" style={{ borderColor: "var(--line)" }}>
                <td className="py-1.5"><input value={m.name} onChange={(e) => update(m.id, { name: e.target.value })} className="border rounded px-1.5 py-0.5 text-sm w-full" style={{ borderColor: "var(--line)" }} /></td>
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
                <td className="py-1.5 text-right"><button onClick={() => remove(m.id)}><Trash2 size={15} color="var(--coral)" /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
