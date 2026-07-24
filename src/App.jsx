import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  LayoutDashboard, FilePlus2, KanbanSquare, BarChart3, Users, Flag,
  Clock, CheckCircle2, AlertTriangle, X, Plus, Trash2, Pencil, Send,
  MessageSquarePlus, Star, ChevronRight, Download, Image as ImageIcon, Save,
  FolderOpen, Heart, Bell, Megaphone, BellRing, Upload, Link as LinkIcon, Search, Trophy, Music
} from "lucide-react";
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, PieChart, Pie, Cell
} from "recharts";
import { storage, ticketsApi, chatApi, rosterApi, galleryApi, musicApi, auth, subscribeAuth, loginWithEmail, logout, uploadMusicTrack, deleteMusicTrackFile, uploadChatAttachment, deleteChatAttachment } from "./firebase.js";
import jsPDF from "jspdf";
import html2canvas from "html2canvas";

// ── ADMIN LOCK ──────────────────────────────────────────────────────
// Only the login email(s) listed here are ever treated as Admin. This is a
// code-level lock: Admin cannot be granted to anyone through the app UI —
// only by editing this list and redeploying. Add your own login email below.
const ADMIN_EMAILS = ["ryemarketing20@gmail.com"];
// ──────────────────────────────────────────────────────────────────

const STATUSES = ["New", "Assigned", "In Progress", "In Revision", "On Hold", "Review", "Completed", "Cancelled"];
const CLOSED_STATUSES = ["Completed", "Cancelled"];
const PAUSED_STATUSES = ["On Hold", "Completed", "Cancelled"]; // excluded from overdue alerts
const PRIORITIES = ["Low", "Normal", "High", "Urgent"];
const DEPTS = ["Social Media", "SEO", "Digital Marketing", "Operations", "Management", "Finance", "Other"];
const ROLES = ["Requester", "Artist", "Team Lead"]; // Admin is not assignable here — see ADMIN_EMAILS above
const CONTENT_TYPES = [
  "Static – Social Media",
  "Static – Website/Landing Page",
  "Static – Ads/Promotional",
  "Static – Email/Newsletter",
  "Video – Reels/Shorts",
  "Video – Promotional/Ads",
  "Video – Webinar/Long-form",
  "Video – Testimonial/Interview",
];
// Buckets any content type into Static/Video — handles old tickets that just
// say "Static" or "Video" (pre-detailed-category) as well as the new list.
function contentSuperType(ct) {
  return (ct || "").startsWith("Video") ? "Video" : "Static";
}
const PURPOSES = ["Ads", "YouTube", "TikTok", "Facebook/IG", "Website", "Other"];
const REVISION_CATEGORIES = ["Typo/Text error", "Wrong color", "Wrong size/dimension", "Layout/alignment", "Wrong image/asset", "Branding inconsistency", "Content/copy change", "Other"];

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

// A palette wide enough that a small team never repeats colors by accident.
const MEMBER_COLOR_PALETTE = [
  "#D99A2B", "#2E6B60", "#C6543D", "#4C6FA8", "#7A6FB0",
  "#3E8E7E", "#B0555F", "#5C8A3A", "#A87A3E", "#4C8FBD",
];
// Admin can pick a custom color per person (roster.color); otherwise everyone
// gets a stable color derived from their id, so it never changes on reload.
function memberColor(member) {
  if (!member) return "var(--muted)";
  if (member.color) return member.color;
  let hash = 0;
  for (const ch of member.id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return MEMBER_COLOR_PALETTE[hash % MEMBER_COLOR_PALETTE.length];
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
    "Priority", "Status", "Date Requested", "Due Date", "Date Completed", "Units", "Reference Link",
    "Minor Revisions", "Major Revisions", "Revision Equivalent", "Satisfaction", "Brief Compliance", "Accuracy",
  ];
  const rows = list.map((t) => {
    const minor = t.revisions.filter((r) => r.type === "minor").length;
    const major = t.revisions.filter((r) => r.type === "major").length;
    return [
      t.ticketNo, t.title, t.dept, t.contentType || "", getPurposes(t).join("; "),
      nameOf(roster, t.requestedBy), nameOf(roster, t.assignedTo),
      t.priority, t.status, t.dateRequested, t.dueDate || "", t.dateCompleted || "", t.units || "", t.referenceLink || "",
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

async function saveAvatar(memberId, dataUrl) {
  try { await storage.set(`avatar_${memberId}`, dataUrl, true); } catch (e) {}
}
async function loadAvatar(memberId) {
  try {
    const res = await storage.get(`avatar_${memberId}`, true);
    return res?.value || null;
  } catch (e) { return null; }
}
async function removeAvatar(memberId) {
  try { if (storage.remove) await storage.remove(`avatar_${memberId}`, true); } catch (e) {}
}

async function saveProfileWallpaper(memberId, dataUrl) {
  try { await storage.set(`profile_wallpaper_${memberId}`, dataUrl, true); } catch (e) {}
}
async function loadProfileWallpaper(memberId) {
  try {
    const res = await storage.get(`profile_wallpaper_${memberId}`, true);
    return res?.value || null;
  } catch (e) { return null; }
}
async function removeProfileWallpaper(memberId) {
  try { if (storage.remove) await storage.remove(`profile_wallpaper_${memberId}`, true); } catch (e) {}
}

function Avatar({ member, size = 28 }) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    let cancelled = false;
    if (member?.hasPhoto) loadAvatar(member.id).then((v) => { if (!cancelled) setUrl(v); });
    else setUrl(null);
    return () => { cancelled = true; };
  }, [member?.id, member?.hasPhoto]);

  if (url) {
    return <img src={url} alt={member?.name || ""} className="rounded-full object-cover flex-shrink-0" style={{ width: size, height: size, border: "1px solid var(--line)" }} />;
  }
  const initial = (member?.name || "?").trim().charAt(0).toUpperCase();
  return (
    <div className="rounded-full flex items-center justify-center flex-shrink-0 font-bold" style={{ width: size, height: size, background: "var(--line)", color: "var(--ink)", fontSize: size * 0.45 }}>
      {initial}
    </div>
  );
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

function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      await loginWithEmail(email.trim(), password);
    } catch (err) {
      setError("Login failed — check your email and password, or contact your Admin.");
    }
    setSubmitting(false);
  };

  return (
    <div className="min-h-[600px] flex items-center justify-center" style={{ background: "var(--paper)", fontFamily: "var(--font-body)" }}>
      <FontStyles />
      <form onSubmit={submit} className="bg-white border rounded-md p-6 w-full max-w-sm" style={{ borderColor: "var(--line)" }}>
        <div className="text-[11px] uppercase tracking-[0.3em] mb-1" style={{ color: "var(--muted)", fontFamily: "var(--font-mono)" }}>IPASS · Creative Production</div>
        <h1 className="text-2xl font-black mb-4" style={{ fontFamily: "var(--font-display)" }}>Sign in to Job Docket</h1>
        <Field label="Email">
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="w-full border rounded px-3 py-2 text-sm" style={{ borderColor: "var(--line)" }} />
        </Field>
        <div className="h-3" />
        <Field label="Password">
          <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} className="w-full border rounded px-3 py-2 text-sm" style={{ borderColor: "var(--line)" }} />
        </Field>
        {error && <div className="text-xs mt-3" style={{ color: "var(--coral)" }}>{error}</div>}
        <button type="submit" disabled={submitting} className="mt-4 w-full py-2 rounded text-white text-sm font-semibold disabled:opacity-50" style={{ background: "var(--ink)" }}>
          {submitting ? "Signing in…" : "Sign in"}
        </button>
        <div className="text-[11px] mt-3" style={{ color: "var(--muted)" }}>No account? Your Admin creates accounts — ask them to add you.</div>
      </form>
    </div>
  );
}

function NoProfileScreen({ email }) {
  return (
    <div className="min-h-[600px] flex items-center justify-center" style={{ background: "var(--paper)", fontFamily: "var(--font-body)" }}>
      <FontStyles />
      <div className="bg-white border rounded-md p-6 w-full max-w-sm text-center" style={{ borderColor: "var(--line)" }}>
        <h1 className="text-xl font-black mb-2" style={{ fontFamily: "var(--font-display)" }}>No linked profile yet</h1>
        <p className="text-sm mb-4" style={{ color: "var(--muted)" }}>
          You're signed in as <b>{email}</b>, but no team profile has this email set yet. Ask your Admin to add you in Team Space → Roster & Settings, with this exact email.
        </p>
        <button onClick={logout} className="px-4 py-2 rounded text-sm font-semibold border" style={{ borderColor: "var(--line)" }}>Sign out</button>
      </div>
    </div>
  );
}

export default function CreativeOpsApp() {
  const [authUser, setAuthUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);

  const [roster, setRoster] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [ticketSeq, setTicketSeq] = useState(0);
  const [view, setView] = useState("dashboard");
  const [ready, setReady] = useState(false);
  const [openTicketId, setOpenTicketId] = useState(null);
  const [wallpaperUrl, setWallpaperUrl] = useState(null);
  const [logoUrl, setLogoUrl] = useState(null);
  const [appTagline, setAppTagline] = useState("");

  useEffect(() => {
    const link = document.getElementById("app-favicon");
    if (link && logoUrl) link.href = logoUrl;
  }, [logoUrl]);

  const [announcements, setAnnouncements] = useState([]);
  const [reminders, setReminders] = useState([]);
  const [endorsements, setEndorsements] = useState([]);
  const [chatMessages, setChatMessages] = useState([]);
  const [galleryItems, setGalleryItems] = useState([]);
  const [musicTracks, setMusicTracks] = useState([]);

  useEffect(() => {
    const unsub = subscribeAuth((u) => {
      setAuthUser(u);
      setAuthLoading(false);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!authUser) {
      setReady(false);
      return;
    }
    let unsubRoster = null;
    let unsubTickets = null;
    let unsubWallpaper = null;
    let unsubLogo = null;
    let unsubTagline = null;
    let unsubAnnouncements = null;
    let unsubReminders = null;
    let unsubEndorsements = null;
    let unsubChat = null;
    let unsubGallery = null;
    let unsubMusic = null;
    let migrationAttempted = false;

    (async () => {
      let seq = 0;
      try {
        const res = await storage.get("ticket_seq", true);
        if (res && res.value) seq = JSON.parse(res.value);
      } catch (e) {}
      setTicketSeq(seq);

      unsubRoster = rosterApi.subscribe(async (list) => {
        if (list.length === 0 && !migrationAttempted) {
          migrationAttempted = true;
          // One-time migration from the old single-document roster (if this
          // team set up profiles before roster moved to per-person storage).
          try {
            const legacy = await storage.get("roster", true);
            if (legacy && legacy.value) {
              const legacyRoster = JSON.parse(legacy.value);
              for (const m of legacyRoster) await rosterApi.upsert(m);
              return; // subscribe fires again with the migrated data
            }
          } catch (e) {}
          const seeded = seedRoster();
          for (const m of seeded) await rosterApi.upsert(m);
          return;
        }
        setRoster(list);
        setReady(true);
      });
      unsubTickets = ticketsApi.subscribe((list) => setTickets(list));
      unsubWallpaper = storage.subscribe("wallpaper_image", true, (val) => setWallpaperUrl(val || null));
      unsubLogo = storage.subscribe("app_logo", true, (val) => setLogoUrl(val || null));
      unsubTagline = storage.subscribe("app_tagline", true, (val) => setAppTagline(val || ""));
      unsubAnnouncements = storage.subscribe("announcements", true, (val) => setAnnouncements(val ? JSON.parse(val) : []));
      unsubReminders = storage.subscribe("reminders", true, (val) => setReminders(val ? JSON.parse(val) : []));
      unsubEndorsements = storage.subscribe("endorsements", true, (val) => setEndorsements(val ? JSON.parse(val) : []));
      unsubChat = chatApi.subscribe((list) => setChatMessages(list));
      unsubGallery = galleryApi.subscribe((list) => setGalleryItems(list));
      unsubMusic = musicApi.subscribe((list) => setMusicTracks(list));
    })();

    return () => {
      if (unsubRoster) unsubRoster();
      if (unsubTickets) unsubTickets();
      if (unsubWallpaper) unsubWallpaper();
      if (unsubLogo) unsubLogo();
      if (unsubTagline) unsubTagline();
      if (unsubAnnouncements) unsubAnnouncements();
      if (unsubReminders) unsubReminders();
      if (unsubEndorsements) unsubEndorsements();
      if (unsubChat) unsubChat();
      if (unsubGallery) unsubGallery();
      if (unsubMusic) unsubMusic();
    };
  }, [authUser]);

  const saveRoster = async (next) => {
    const previousIds = new Set(roster.map((m) => m.id));
    const nextIds = new Set(next.map((m) => m.id));
    setRoster(next);
    for (const m of next) {
      try { await rosterApi.upsert(m); } catch (e) {}
    }
    for (const id of previousIds) {
      if (!nextIds.has(id)) {
        try { await rosterApi.remove(id); } catch (e) {}
      }
    }
  };
  const saveWallpaper = async (dataUrl) => {
    setWallpaperUrl(dataUrl);
    try { await storage.set("wallpaper_image", dataUrl, true); } catch (e) {}
  };
  const clearWallpaper = async () => {
    setWallpaperUrl(null);
    try { if (storage.remove) await storage.remove("wallpaper_image", true); } catch (e) {}
  };
  const saveLogo = async (dataUrl) => {
    setLogoUrl(dataUrl);
    try { await storage.set("app_logo", dataUrl, true); } catch (e) {}
  };
  const clearLogo = async () => {
    setLogoUrl(null);
    try { if (storage.remove) await storage.remove("app_logo", true); } catch (e) {}
  };
  const saveTagline = async (text) => {
    setAppTagline(text);
    try { await storage.set("app_tagline", text, true); } catch (e) {}
  };
  const saveSeq = async (next) => {
    setTicketSeq(next);
    try { await storage.set("ticket_seq", JSON.stringify(next), true); } catch (e) {}
  };

  // Identity is now the logged-in account, not a free-pick dropdown: your
  // profile is whichever roster member has a matching email. Admin status is
  // a fixed code-level list (ADMIN_EMAILS above) — never editable in the UI.
  const isAdmin = !!authUser?.email && ADMIN_EMAILS.map((e) => e.toLowerCase()).includes(authUser.email.toLowerCase());
  const currentUser = roster.find((m) => m.email && authUser?.email && m.email.toLowerCase() === authUser.email.toLowerCase());
  const isLead = isAdmin || currentUser?.role === "Team Lead";

  const postAnnouncement = async (text) => {
    if (!text.trim()) return;
    const next = [{ id: uid(), text, by: currentUser?.name || "Unknown", date: new Date().toISOString() }, ...announcements];
    setAnnouncements(next);
    try { await storage.set("announcements", JSON.stringify(next), true); } catch (e) {}
  };
  const deleteAnnouncement = async (id) => {
    const next = announcements.filter((a) => a.id !== id);
    setAnnouncements(next);
    try { await storage.set("announcements", JSON.stringify(next), true); } catch (e) {}
  };

  const addReminder = async (text, dueDate) => {
    if (!text.trim()) return;
    const next = [...reminders, { id: uid(), text, dueDate: dueDate || null, by: currentUser?.name || "Unknown", date: new Date().toISOString() }];
    setReminders(next);
    try { await storage.set("reminders", JSON.stringify(next), true); } catch (e) {}
  };
  const deleteReminder = async (id) => {
    const next = reminders.filter((r) => r.id !== id);
    setReminders(next);
    try { await storage.set("reminders", JSON.stringify(next), true); } catch (e) {}
  };

  const addEndorsement = async (toMemberId, message) => {
    if (!message.trim()) return;
    const next = [{ id: uid(), toMemberId, fromId: currentUser?.id || null, fromName: currentUser?.name || "Unknown", message, date: new Date().toISOString() }, ...endorsements];
    setEndorsements(next);
    try { await storage.set("endorsements", JSON.stringify(next), true); } catch (e) {}
  };
  const deleteEndorsement = async (id) => {
    const next = endorsements.filter((e2) => e2.id !== id);
    setEndorsements(next);
    try { await storage.set("endorsements", JSON.stringify(next), true); } catch (e) {}
  };

  const sendChatMessage = async (text, attachmentUrl) => {
    if ((!text || !text.trim()) && !attachmentUrl) return;
    if (!currentUser) return;
    await chatApi.upsert({ id: uid(), text: (text || "").trim(), attachmentUrl: attachmentUrl || null, by: currentUser.name, byId: currentUser.id, date: new Date().toISOString() });
  };
  const deleteChatMessage = async (id, attachmentUrl) => {
    await chatApi.remove(id);
    if (attachmentUrl) await deleteChatAttachment(attachmentUrl);
  };

  const addGalleryItem = async (memberId, dataUrl, caption) => {
    await galleryApi.upsert({ id: uid(), memberId, dataUrl, caption: caption || "", date: new Date().toISOString() });
  };
  const removeGalleryItem = async (id) => {
    await galleryApi.remove(id);
  };

  const MUSIC_LIMIT_PER_MEMBER = 3;
  const addMusicTrack = async (memberId, memberName, title, file) => {
    const mine = musicTracks.filter((t) => t.memberId === memberId);
    if (mine.length >= MUSIC_LIMIT_PER_MEMBER) return { error: `You've already got ${MUSIC_LIMIT_PER_MEMBER} tracks up — remove one first.` };
    const trackId = uid();
    try {
      const audioUrl = await uploadMusicTrack(trackId, file);
      await musicApi.upsert({ id: trackId, memberId, memberName, title: title || "", audioUrl, date: new Date().toISOString() });
      return { ok: true };
    } catch (e) {
      return { error: "Upload failed. Try again." };
    }
  };
  const removeMusicTrack = async (track) => {
    await musicApi.remove(track.id);
    await deleteMusicTrackFile(track.id);
  };

  // Lazy auto-cleanup: runs whenever the relevant list changes (i.e. whenever
  // someone has that tab open), rather than needing a separate always-on
  // server — there's no backend process in this app to run a real cron job.
  const cleanedMusicIds = useRef(new Set());
  useEffect(() => {
    const cutoff = Date.now() - 3 * 24 * 60 * 60 * 1000;
    for (const t of musicTracks) {
      if (cleanedMusicIds.current.has(t.id)) continue;
      if (new Date(t.date).getTime() < cutoff) {
        cleanedMusicIds.current.add(t.id);
        removeMusicTrack(t);
      }
    }
  }, [musicTracks]);

  const cleanedAttachmentIds = useRef(new Set());
  useEffect(() => {
    const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
    for (const m of chatMessages) {
      if (!m.attachmentUrl || cleanedAttachmentIds.current.has(m.id)) continue;
      if (new Date(m.date).getTime() < cutoff) {
        cleanedAttachmentIds.current.add(m.id);
        deleteChatAttachment(m.attachmentUrl);
        if (m.text && m.text.trim()) {
          chatApi.upsert({ ...m, attachmentUrl: null });
        } else {
          chatApi.remove(m.id);
        }
      }
    }
  }, [chatMessages]);

  const exportBackup = () => {
    const backup = {
      exportedAt: new Date().toISOString(),
      roster, tickets, ticketSeq, announcements, reminders, endorsements,
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `job-docket-backup-${todayISO()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const restoreBackup = async (file) => {
    if (!file) return;
    const text = await file.text();
    let data;
    try { data = JSON.parse(text); } catch (e) { window.alert("That file isn't valid backup JSON."); return; }
    if (!window.confirm("Restore this backup? Roster, announcements, and reminders will be replaced. Tickets in the backup will be added or overwritten — tickets created since the backup was made will not be deleted.")) return;
    if (Array.isArray(data.roster)) await saveRoster(data.roster);
    if (typeof data.ticketSeq === "number") await saveSeq(data.ticketSeq);
    if (Array.isArray(data.tickets)) {
      for (const t of data.tickets) await ticketsApi.upsert(t);
    }
    if (Array.isArray(data.announcements)) {
      setAnnouncements(data.announcements);
      try { await storage.set("announcements", JSON.stringify(data.announcements), true); } catch (e) {}
    }
    if (Array.isArray(data.reminders)) {
      setReminders(data.reminders);
      try { await storage.set("reminders", JSON.stringify(data.reminders), true); } catch (e) {}
    }
    if (Array.isArray(data.endorsements)) {
      setEndorsements(data.endorsements);
      try { await storage.set("endorsements", JSON.stringify(data.endorsements), true); } catch (e) {}
    }
    window.alert("Restore complete.");
  };

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
      referenceLink: "",
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

  if (authLoading) {
    return (
      <div className="min-h-[400px] flex items-center justify-center text-[var(--muted)]" style={{ fontFamily: "var(--font-mono)" }}>
        checking session…
      </div>
    );
  }

  if (!authUser) {
    return <LoginScreen />;
  }

  if (!ready) {
    return (
      <div className="min-h-[400px] flex items-center justify-center text-[var(--muted)]" style={{ fontFamily: "var(--font-mono)" }}>
        loading docket…
      </div>
    );
  }

  if (!currentUser && !isAdmin) {
    return <NoProfileScreen email={authUser.email} />;
  }

  const outerStyle = {
    fontFamily: "var(--font-body)",
    color: "var(--ink)",
    ...(wallpaperUrl
      ? { backgroundImage: `url(${wallpaperUrl})`, backgroundSize: "cover", backgroundPosition: "center", backgroundAttachment: "fixed" }
      : { background: "var(--paper)" }),
  };

  return (
    <div style={outerStyle} className="min-h-[600px] w-full">
      <FontStyles />
      <Header
        authUser={authUser}
        isAdmin={isAdmin}
        tickets={tickets}
        announcements={announcements}
        endorsements={endorsements}
        currentUser={currentUser}
        onOpen={setOpenTicketId}
        setView={setView}
        logoUrl={logoUrl}
        appTagline={appTagline}
      />
      <TabBar view={view} setView={setView} />
      <main className="px-4 md:px-8 py-6 max-w-6xl mx-auto">
        {view === "dashboard" && (
          <DashboardView
            tickets={tickets}
            roster={roster}
            onOpen={setOpenTicketId}
            setView={setView}
            announcements={announcements}
            isLead={isLead}
            postAnnouncement={postAnnouncement}
            deleteAnnouncement={deleteAnnouncement}
            reminders={reminders}
            addReminder={addReminder}
            deleteReminder={deleteReminder}
          />
        )}
        {view === "new" && <NewRequestForm roster={roster} currentUser={currentUser} onCreate={createTicket} />}
        {view === "board" && <BoardView tickets={tickets} roster={roster} onOpen={setOpenTicketId} />}
        {view === "directory" && <DirectoryView tickets={tickets} roster={roster} onOpen={setOpenTicketId} />}
        {view === "reports" && <ReportsView tickets={tickets} roster={roster} />}
        {view === "teamspace" && (
          <TeamHub
            roster={roster}
            currentUser={currentUser}
            isLead={isLead}
            isAdmin={isAdmin}
            endorsements={endorsements}
            addEndorsement={addEndorsement}
            deleteEndorsement={deleteEndorsement}
            saveRoster={saveRoster}
            tickets={tickets}
            galleryItems={galleryItems}
            addGalleryItem={addGalleryItem}
            removeGalleryItem={removeGalleryItem}
            chatMessages={chatMessages}
            sendChatMessage={sendChatMessage}
            deleteChatMessage={deleteChatMessage}
            musicTracks={musicTracks}
            addMusicTrack={addMusicTrack}
            removeMusicTrack={removeMusicTrack}
            wallpaperUrl={wallpaperUrl}
            saveWallpaper={saveWallpaper}
            clearWallpaper={clearWallpaper}
            logoUrl={logoUrl}
            saveLogo={saveLogo}
            clearLogo={clearLogo}
            appTagline={appTagline}
            saveTagline={saveTagline}
            exportBackup={exportBackup}
            restoreBackup={restoreBackup}
          />
        )}
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

function Header({ authUser, isAdmin, tickets, announcements, endorsements, currentUser, onOpen, setView, logoUrl, appTagline }) {
  return (
    <div className="border-b-2" style={{ borderColor: "var(--ink)" }}>
      <div className="max-w-6xl mx-auto px-4 md:px-8 pt-6 pb-4 flex flex-wrap items-end justify-between gap-3">
        <div className="flex items-center gap-3">
          {logoUrl && <img src={logoUrl} alt="logo" className="h-10 w-10 object-contain rounded" />}
          <div>
            <div className="text-[11px] uppercase tracking-[0.3em]" style={{ color: "var(--muted)", fontFamily: "var(--font-mono)" }}>
              {appTagline || "IPASS · Creative Production"}
            </div>
            <h1 className="text-3xl md:text-4xl font-black tracking-tight" style={{ fontFamily: "var(--font-display)" }}>Job Docket</h1>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <NotificationBell tickets={tickets} announcements={announcements} endorsements={endorsements} currentUser={currentUser} onOpen={onOpen} setView={setView} />
          <div className="flex items-center gap-2 text-sm" style={{ color: "var(--muted)" }}>
            <Avatar member={currentUser} size={26} />
            <div>
              <div className="font-semibold" style={{ color: "var(--ink)" }}>{currentUser?.name || authUser?.email}</div>
              <div className="text-[11px]">{isAdmin ? "Admin" : currentUser?.role}</div>
            </div>
            <button onClick={logout} title="Sign out" className="ml-2 px-2 py-1 rounded border text-xs font-semibold" style={{ borderColor: "var(--line)" }}>Sign out</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function NotificationBell({ tickets, announcements, endorsements, currentUser, onOpen, setView }) {
  const [open, setOpen] = useState(false);
  const [lastSeen, setLastSeen] = useState(null);
  const [loadedSeen, setLoadedSeen] = useState(false);

  useEffect(() => {
    if (!currentUser?.id) return;
    (async () => {
      try {
        const res = await storage.get(`notif_last_seen_${currentUser.id}`, false);
        setLastSeen(res?.value ? new Date(res.value) : new Date(0));
      } catch (e) { setLastSeen(new Date(0)); }
      setLoadedSeen(true);
    })();
  }, [currentUser?.id]);

  const items = useMemo(() => {
    if (!currentUser) return [];
    const fromTickets = tickets
      .filter((t) => t.assignedTo === currentUser.id || t.requestedBy === currentUser.id)
      .flatMap((t) => t.history.map((h) => ({ date: h.date, text: `${h.action} — JOB-${String(t.ticketNo).padStart(4, "0")}`, ticketId: t.id })));
    const fromAnnouncements = announcements.map((a) => ({ date: a.date, text: `Announcement: ${a.text}`, ticketId: null }));
    const fromEndorsements = (endorsements || [])
      .filter((e) => e.toMemberId === currentUser.id)
      .map((e) => ({ date: e.date, text: `New message from ${e.fromName}`, ticketId: null, isPrivateMessage: true }));
    return [...fromTickets, ...fromAnnouncements, ...fromEndorsements].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 20);
  }, [tickets, announcements, endorsements, currentUser]);

  const unreadCount = loadedSeen ? items.filter((i) => new Date(i.date) > lastSeen).length : 0;

  const markAllRead = async () => {
    const now = new Date().toISOString();
    setLastSeen(new Date(now));
    try { await storage.set(`notif_last_seen_${currentUser.id}`, now, false); } catch (e) {}
  };

  const handleItemClick = (item) => {
    setOpen(false);
    if (item.ticketId) onOpen(item.ticketId);
    else if (item.isPrivateMessage) setView("teamspace");
    else setView("dashboard");
  };

  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} className="relative p-2 rounded-full border" style={{ borderColor: "var(--line)", background: "white" }}>
        {unreadCount > 0 ? <BellRing size={16} color="var(--coral)" /> : <Bell size={16} color="var(--muted)" />}
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 text-[9px] font-bold text-white rounded-full w-4 h-4 flex items-center justify-center" style={{ background: "var(--coral)" }}>
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-72 bg-white border rounded-md shadow-lg z-50 max-h-96 overflow-y-auto" style={{ borderColor: "var(--line)" }}>
          <div className="p-2 flex items-center justify-between border-b" style={{ borderColor: "var(--line)" }}>
            <span className="text-xs font-bold uppercase tracking-wide" style={{ color: "var(--muted)" }}>Notifications</span>
            <button onClick={markAllRead} className="text-[11px] font-semibold" style={{ color: "var(--teal)" }}>Mark all read</button>
          </div>
          {items.length === 0 ? (
            <div className="p-4 text-xs text-center" style={{ color: "var(--muted)" }}>Nothing yet.</div>
          ) : (
            items.map((item, i) => (
              <button key={i} onClick={() => handleItemClick(item)} className="w-full text-left px-3 py-2 text-xs border-b hover:bg-[var(--paper)]" style={{ borderColor: "var(--line)" }}>
                <div>{item.text}</div>
                <div style={{ color: "var(--muted)" }}>{new Date(item.date).toLocaleString()}</div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function TabBar({ view, setView }) {
  const tabs = [
    { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    { id: "new", label: "New Request", icon: FilePlus2 },
    { id: "board", label: "Board", icon: KanbanSquare },
    { id: "directory", label: "Directory", icon: FolderOpen },
    { id: "reports", label: "Reports", icon: BarChart3 },
    { id: "teamspace", label: "Team Space", icon: Heart },
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
  const assignee = roster.find((m) => m.id === ticket.assignedTo);
  const accent = memberColor(assignee);
  return (
    <button onClick={() => onOpen(ticket.id)} className="text-left w-full bg-white rounded-md shadow-sm border hover:shadow-md transition-shadow" style={{ borderColor: "var(--line)", borderLeft: `4px solid ${accent}` }}>
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
        <div className="text-xs mb-2 flex items-center gap-1.5" style={{ color: "var(--muted)" }}>
          {assignee ? (
            <span className="flex-shrink-0 rounded-full" style={{ border: `2px solid ${accent}`, lineHeight: 0 }}>
              <Avatar member={assignee} size={18} />
            </span>
          ) : (
            <span className="inline-block rounded-full flex-shrink-0" style={{ width: 8, height: 8, background: accent }} />
          )}
          <span className="truncate">{ticket.dept} · {ticket.contentType || "—"}{getPurposes(ticket).length ? ` · ${getPurposes(ticket).join(", ")}` : ""} · {nameOf(roster, ticket.assignedTo)}</span>
        </div>
        <div className="flex items-center justify-between">
          <StatusPill status={ticket.status} />
          {overdue && <span className="flex items-center gap-1 text-[11px] font-semibold" style={{ color: "var(--coral)" }}><AlertTriangle size={12} /> overdue</span>}
        </div>
      </div>
    </button>
  );
}

function AnnouncementsPanel({ announcements, isLead, postAnnouncement, deleteAnnouncement }) {
  const [text, setText] = useState("");
  const [showForm, setShowForm] = useState(false);

  const submit = () => {
    if (!text.trim()) return;
    postAnnouncement(text);
    setText("");
    setShowForm(false);
  };

  if (announcements.length === 0 && !isLead) return null;

  return (
    <div className="bg-white border rounded-md p-4" style={{ borderColor: "var(--amber)" }}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Megaphone size={14} color="var(--amber)" />
          <SectionTitle>Announcements</SectionTitle>
        </div>
        {isLead && <button onClick={() => setShowForm((s) => !s)} className="text-[11px] font-semibold" style={{ color: "var(--teal)" }}>{showForm ? "Cancel" : "+ Post"}</button>}
      </div>
      {showForm && (
        <div className="flex gap-2 mt-2">
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Team announcement…" className="flex-1 border rounded px-2 py-1 text-sm" style={{ borderColor: "var(--line)" }} />
          <button onClick={submit} className="px-3 py-1 rounded text-white text-xs font-semibold" style={{ background: "var(--ink)" }}>Post</button>
        </div>
      )}
      <div className="mt-2 space-y-2">
        {announcements.length === 0 && <div className="text-xs" style={{ color: "var(--muted)" }}>No announcements yet.</div>}
        {announcements.map((a) => (
          <div key={a.id} className="text-sm flex items-start justify-between gap-2">
            <div>
              {a.text}
              <div className="text-[11px]" style={{ color: "var(--muted)" }}>{a.by} · {new Date(a.date).toLocaleDateString()}</div>
            </div>
            {isLead && <button onClick={() => deleteAnnouncement(a.id)}><X size={13} color="var(--muted)" /></button>}
          </div>
        ))}
      </div>
    </div>
  );
}

function RemindersPanel({ reminders, addReminder, deleteReminder }) {
  const [text, setText] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [showForm, setShowForm] = useState(false);

  const submit = () => {
    if (!text.trim()) return;
    addReminder(text, dueDate);
    setText(""); setDueDate("");
    setShowForm(false);
  };

  const sorted = [...reminders].sort((a, b) => (a.dueDate || "9999") < (b.dueDate || "9999") ? -1 : 1);

  if (reminders.length === 0 && !showForm) {
    return (
      <div className="bg-white border rounded-md p-4" style={{ borderColor: "var(--line)" }}>
        <div className="flex items-center justify-between">
          <SectionTitle>Reminders</SectionTitle>
          <button onClick={() => setShowForm(true)} className="text-[11px] font-semibold" style={{ color: "var(--teal)" }}>+ Add</button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white border rounded-md p-4" style={{ borderColor: "var(--line)" }}>
      <div className="flex items-center justify-between">
        <SectionTitle>Reminders</SectionTitle>
        <button onClick={() => setShowForm((s) => !s)} className="text-[11px] font-semibold" style={{ color: "var(--teal)" }}>{showForm ? "Cancel" : "+ Add"}</button>
      </div>
      {showForm && (
        <div className="flex flex-wrap gap-2 mt-2">
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Reminder…" className="flex-1 border rounded px-2 py-1 text-sm" style={{ borderColor: "var(--line)" }} />
          <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="border rounded px-2 py-1 text-sm" style={{ borderColor: "var(--line)" }} />
          <button onClick={submit} className="px-3 py-1 rounded text-white text-xs font-semibold" style={{ background: "var(--ink)" }}>Add</button>
        </div>
      )}
      <div className="mt-2 space-y-1.5">
        {sorted.map((r) => {
          const overdue = r.dueDate && r.dueDate < todayISO();
          return (
            <div key={r.id} className="text-sm flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Clock size={12} color={overdue ? "var(--coral)" : "var(--muted)"} />
                <span>{r.text}</span>
                {r.dueDate && <span className="text-[11px]" style={{ color: overdue ? "var(--coral)" : "var(--muted)" }}>({r.dueDate})</span>}
              </div>
              <button onClick={() => deleteReminder(r.id)}><X size={13} color="var(--muted)" /></button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function LeaderboardPanel({ tickets, roster }) {
  const members = roster.filter((m) => m.role === "Artist" || m.role === "Team Lead");
  const ranked = members
    .map((m) => {
      const done = tickets.filter((t) => t.assignedTo === m.id && t.status === "Completed");
      const avgRev = done.length ? done.reduce((s, t) => s + revisionEquivalent(t), 0) / done.length : 0;
      // Completions carry the most weight, but a lower average revision count
      // (fewer minor/major revisions per project) pulls someone up the board —
      // most completed AND cleanest work wins, not just raw volume.
      return { member: m, completed: done.length, avgRev: Number(avgRev.toFixed(2)), score: done.length - avgRev };
    })
    .filter((r) => r.completed > 0)
    .sort((a, b) => b.score - a.score || b.completed - a.completed || a.avgRev - b.avgRev)
    .slice(0, 5);

  const medalColor = ["#D9A441", "#A8A8A8", "#B08D57"];
  const avatarSize = (i) => (i === 0 ? 52 : i === 1 ? 40 : i === 2 ? 36 : 28);

  return (
    <div className="bg-white border rounded-md p-4" style={{ borderColor: "var(--amber)" }}>
      <div className="flex items-center gap-1.5">
        <Trophy size={14} color="var(--amber)" />
        <SectionTitle>Leaderboard — most completed, lowest revisions (all-time)</SectionTitle>
      </div>
      {ranked.length === 0 ? (
        <EmptyState text="No completed projects yet — first one on the board wins." />
      ) : (
        <div className="mt-3 space-y-3">
          {ranked.map((r, i) => (
            <div key={r.member.id} className="flex items-center gap-3" style={{ opacity: i === 0 ? 1 : 0.92 }}>
              <div className="w-6 text-center font-black flex-shrink-0" style={{ fontFamily: "var(--font-display)", color: i < 3 ? medalColor[i] : "var(--muted)" }}>
                {i < 3 ? <Trophy size={i === 0 ? 20 : 16} color={medalColor[i]} /> : i + 1}
              </div>
              <div style={i === 0 ? { boxShadow: "0 0 0 3px var(--amber)", borderRadius: "9999px" } : {}}>
                <Avatar member={r.member} size={avatarSize(i)} />
              </div>
              <div className="flex-1">
                <div className={i === 0 ? "text-base font-black" : "text-sm font-semibold"} style={i === 0 ? { fontFamily: "var(--font-display)" } : {}}>{r.member.name}</div>
                <div className="text-[11px]" style={{ color: i === 0 ? "var(--amber)" : "var(--muted)" }}>
                  {i === 0 ? "Top performer — " : ""}{r.completed} completed · {r.avgRev} avg revisions
                </div>
              </div>
              <div className={i === 0 ? "text-xl font-black" : "text-sm font-black"} style={{ fontFamily: "var(--font-display)" }}>{r.completed}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DashboardView({ tickets, roster, onOpen, setView, announcements, isLead, postAnnouncement, deleteAnnouncement, reminders, addReminder, deleteReminder }) {
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
      <AnnouncementsPanel announcements={announcements} isLead={isLead} postAnnouncement={postAnnouncement} deleteAnnouncement={deleteAnnouncement} />
      <RemindersPanel reminders={reminders} addReminder={addReminder} deleteReminder={deleteReminder} />
      <LeaderboardPanel tickets={tickets} roster={roster} />
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

function StatCard({ label, value, icon: Icon, alert, trendPct, invertTrend, trendLabel }) {
  const hasTrend = trendPct !== undefined && trendPct !== null;
  const up = hasTrend && trendPct >= 0;
  const good = invertTrend ? !up : up;
  return (
    <div className="bg-white border rounded-md p-3 flex-1" style={{ borderColor: alert ? "var(--coral)" : "var(--line)" }}>
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider" style={{ color: "var(--muted)" }}><Icon size={13} /> {label}</div>
      <div className="flex items-baseline gap-2 mt-1">
        <div className="text-2xl font-black" style={{ fontFamily: "var(--font-display)", color: alert ? "var(--coral)" : "var(--ink)" }}>{value}</div>
        {hasTrend && (
          <span className="text-[11px] font-semibold" style={{ color: good ? "var(--teal)" : "var(--coral)" }}>
            {up ? "▲" : "▼"} {Math.abs(trendPct)}% {trendLabel || "vs last month"}
          </span>
        )}
      </div>
    </div>
  );
}

function SectionTitle({ children }) {
  return <div className="text-xs font-bold uppercase tracking-widest" style={{ color: "var(--muted)" }}>{children}</div>;
}

function ChartTypeToggle({ value, onChange, options }) {
  return (
    <div className="flex border rounded overflow-hidden" style={{ borderColor: "var(--line)" }}>
      {options.map((o) => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          className="px-2 py-0.5 text-[11px] font-semibold"
          style={{ background: value === o.id ? "var(--ink)" : "white", color: value === o.id ? "white" : "var(--muted)" }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function EmptyState({ text }) {
  return <div className="text-sm py-6 text-center" style={{ color: "var(--muted)" }}>{text}</div>;
}

function NewRequestForm({ roster, currentUser, onCreate }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [requesterNotes, setRequesterNotes] = useState("");
  const [dept, setDept] = useState(currentUser?.dept || "Social Media");
  const [contentType, setContentType] = useState(CONTENT_TYPES[0]);
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
        <div className="flex flex-wrap gap-2 ml-auto">
          {roster.filter((m) => m.role === "Artist" || m.role === "Team Lead").map((m) => (
            <span key={m.id} className="flex items-center gap-1 text-[11px]" style={{ color: "var(--muted)" }}>
              <span className="inline-block rounded-full" style={{ width: 9, height: 9, background: memberColor(m) }} /> {m.name}
            </span>
          ))}
        </div>
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

function DirectoryView({ tickets, roster, onOpen }) {
  const [search, setSearch] = useState("");
  const completed = tickets.filter((t) => t.status === "Completed");
  const q = search.trim().toLowerCase();
  const filtered = q
    ? completed.filter((t) =>
        t.title.toLowerCase().includes(q) ||
        t.dept.toLowerCase().includes(q) ||
        getPurposes(t).some((p) => p.toLowerCase().includes(q)) ||
        nameOf(roster, t.assignedTo).toLowerCase().includes(q)
      )
    : completed;
  const sorted = [...filtered].sort((a, b) => new Date(b.dateCompleted || 0) - new Date(a.dateCompleted || 0));

  return (
    <div className="space-y-4">
      <SectionTitle>Completed work directory ({completed.length})</SectionTitle>
      <div className="relative max-w-sm">
        <Search size={14} className="absolute left-2.5 top-2.5" color="var(--muted)" />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search title, department, purpose, artist…" className="w-full border rounded pl-8 pr-3 py-2 text-sm" style={{ borderColor: "var(--line)" }} />
      </div>
      {sorted.length === 0 ? (
        <EmptyState text={completed.length === 0 ? "No completed projects yet." : "No matches."} />
      ) : (
        <div className="bg-white border rounded-md overflow-x-auto" style={{ borderColor: "var(--line)" }}>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase" style={{ color: "var(--muted)" }}>
                <th className="p-3">Job</th>
                <th className="p-3">Title</th>
                <th className="p-3">Dept / Purpose</th>
                <th className="p-3">Artist</th>
                <th className="p-3">Completed</th>
                <th className="p-3">Reference link</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((t) => (
                <tr key={t.id} className="border-t" style={{ borderColor: "var(--line)" }}>
                  <td className="p-3" style={{ fontFamily: "var(--font-mono)", color: "var(--muted)" }}>JOB-{String(t.ticketNo).padStart(4, "0")}</td>
                  <td className="p-3">
                    <button onClick={() => onOpen(t.id)} className="font-medium underline text-left" style={{ color: "var(--ink)" }}>{t.title}</button>
                  </td>
                  <td className="p-3 text-xs" style={{ color: "var(--muted)" }}>{t.dept} · {getPurposes(t).join(", ") || "—"}</td>
                  <td className="p-3 text-xs">{nameOf(roster, t.assignedTo)}</td>
                  <td className="p-3 text-xs">{t.dateCompleted || "—"}</td>
                  <td className="p-3 text-xs">
                    {t.referenceLink ? (
                      <a href={t.referenceLink} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 underline" style={{ color: "var(--teal)" }}>
                        <LinkIcon size={12} /> {t.referenceLink}
                      </a>
                    ) : (
                      <span style={{ color: "var(--muted)" }}>—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ChatView({ messages, roster, currentUser, isLead, sendMessage, deleteMessage }) {
  const [text, setText] = useState("");
  const [pendingAttachment, setPendingAttachment] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [attachError, setAttachError] = useState("");
  const sorted = [...messages].sort((a, b) => new Date(a.date) - new Date(b.date));
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  const MAX_ATTACHMENT_MB = 8;
  const handleAttach = async (file) => {
    if (!file) return;
    setAttachError("");
    if (!file.type.startsWith("image/")) {
      setAttachError("Only images and GIFs are supported.");
      return;
    }
    if (file.size > MAX_ATTACHMENT_MB * 1024 * 1024) {
      setAttachError(`Keep it under ${MAX_ATTACHMENT_MB}MB.`);
      return;
    }
    setUploading(true);
    try {
      const url = await uploadChatAttachment(uid(), file);
      setPendingAttachment(url);
    } catch (e) {
      setAttachError("Upload failed. Try again.");
    }
    setUploading(false);
  };

  const submit = (e) => {
    e.preventDefault();
    if (!text.trim() && !pendingAttachment) return;
    sendMessage(text, pendingAttachment);
    setText("");
    setPendingAttachment(null);
  };

  const memberFor = (byId) => roster.find((m) => m.id === byId);

  return (
    <div className="bg-white border rounded-md flex flex-col" style={{ borderColor: "var(--line)", height: "70vh" }}>
      <div className="p-3 border-b" style={{ borderColor: "var(--line)" }}>
        <SectionTitle>Team Chat</SectionTitle>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {sorted.length === 0 && <EmptyState text="No messages yet — say hi!" />}
        {sorted.map((m) => {
          const isMine = m.byId === currentUser?.id;
          return (
            <div key={m.id} className={`flex items-start gap-2 ${isMine ? "flex-row-reverse" : ""}`}>
              <Avatar member={memberFor(m.byId)} size={26} />
              <div className={`max-w-[70%] ${isMine ? "items-end" : "items-start"} flex flex-col`}>
                {m.attachmentUrl && (
                  <img src={m.attachmentUrl} alt="shared" className="rounded-lg mb-1 max-h-56 max-w-full" style={{ border: "1px solid var(--line)" }} />
                )}
                {m.text && (
                  <div className="rounded-lg px-3 py-1.5 text-sm" style={{ background: isMine ? "var(--ink)" : "var(--paper)", color: isMine ? "white" : "var(--ink)" }}>
                    {m.text}
                  </div>
                )}
                <div className="text-[10px] mt-0.5 flex items-center gap-1.5" style={{ color: "var(--muted)" }}>
                  {m.by} · {new Date(m.date).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  {(isMine || isLead) && <button onClick={() => deleteMessage(m.id, m.attachmentUrl)}><X size={10} /></button>}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
      {pendingAttachment && (
        <div className="px-3 pt-2 flex items-center gap-2">
          <img src={pendingAttachment} alt="attachment preview" className="h-14 rounded border" style={{ borderColor: "var(--line)" }} />
          <button onClick={() => setPendingAttachment(null)} className="text-xs font-semibold" style={{ color: "var(--coral)" }}>Remove</button>
        </div>
      )}
      {(uploading || attachError) && (
        <div className="px-3 pt-1 text-xs" style={{ color: attachError ? "var(--coral)" : "var(--muted)" }}>
          {attachError || "Uploading…"}
        </div>
      )}
      <form onSubmit={submit} className="p-3 border-t flex gap-2 items-center" style={{ borderColor: "var(--line)" }}>
        <label className="cursor-pointer flex-shrink-0" title="Attach image or GIF">
          <ImageIcon size={18} color="var(--muted)" />
          <input type="file" accept="image/*" className="hidden" onChange={(e) => handleAttach(e.target.files?.[0])} />
        </label>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Message the team…" className="flex-1 border rounded px-3 py-2 text-sm" style={{ borderColor: "var(--line)" }} />
        <button type="submit" className="px-4 py-2 rounded text-white text-sm font-semibold flex items-center gap-1.5" style={{ background: "var(--ink)" }}><Send size={14} /> Send</button>
      </form>
    </div>
  );
}

function TicketModal({ ticket, roster, currentUser, isLead, onClose, onUpdate, onDelete }) {
  const [note, setNote] = useState("");
  const [revType, setRevType] = useState("minor");
  const [revCategory, setRevCategory] = useState(REVISION_CATEGORIES[0]);
  const [sat, setSat] = useState(ticket.satisfactionScore || 0);
  const [comp, setComp] = useState(ticket.briefCompliance || 0);
  const [editing, setEditing] = useState(false);
  const [imageUrl, setImageUrl] = useState(null);
  const [revisionPoint, setRevisionPoint] = useState("");
  const [unitsInput, setUnitsInput] = useState(ticket.units || "");
  const [refLinkInput, setRefLinkInput] = useState(ticket.referenceLink || "");

  const [eTitle, setETitle] = useState(ticket.title);
  const [eDesc, setEDesc] = useState(ticket.description);
  const [eNotes, setENotes] = useState(ticket.requesterNotes || "");
  const [eDept, setEDept] = useState(ticket.dept);
  const [eContentType, setEContentType] = useState(ticket.contentType || CONTENT_TYPES[0]);
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
      (t) => ({ ...t, revisions: [...t.revisions, { id: uid(), type: revType, category: revCategory, note, taggedBy: currentUser?.name, date: new Date().toISOString() }] }),
      { __label: `${revType === "minor" ? "Minor" : "Major"} revision logged (${revCategory})` }
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
  const saveRefLink = () => {
    if (!refLinkInput.trim()) return;
    onUpdate(ticket.id, Object.assign((t) => ({ ...t, referenceLink: refLinkInput.trim() }), { __label: "Reference link added" }));
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
              <div className="flex flex-wrap gap-2 mt-2">
                <select value={revType} onChange={(e) => setRevType(e.target.value)} className="border rounded px-2 py-1 text-xs" style={{ borderColor: "var(--line)" }}>
                  <option value="minor">Minor</option>
                  <option value="major">Major</option>
                </select>
                <select value={revCategory} onChange={(e) => setRevCategory(e.target.value)} className="border rounded px-2 py-1 text-xs" style={{ borderColor: "var(--line)" }}>
                  {REVISION_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="What changed?" className="flex-1 border rounded px-2 py-1 text-xs min-w-[120px]" style={{ borderColor: "var(--line)" }} />
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

              <div className="mt-3">
                <SectionTitle>Reference link (Team Lead) — for the completed-work directory</SectionTitle>
                <div className="flex gap-2 mt-2 items-center">
                  <input type="url" value={refLinkInput} onChange={(e) => setRefLinkInput(e.target.value)} placeholder="https://…" className="flex-1 border rounded px-2 py-1 text-xs" style={{ borderColor: "var(--line)" }} />
                  <button onClick={saveRefLink} className="px-2 py-1 rounded text-white text-xs font-semibold" style={{ background: "var(--ink)" }}>Save link</button>
                </div>
                {ticket.referenceLink && <div className="text-xs mt-1" style={{ color: "var(--muted)" }}>Currently: {ticket.referenceLink}</div>}
              </div>

              <button
                onClick={complete}
                disabled={!ticket.units || !ticket.referenceLink}
                title={!ticket.units || !ticket.referenceLink ? "Set units and reference link before marking complete" : ""}
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
              {ticket.referenceLink && (
                <div className="text-xs mt-1">
                  Reference: <a href={ticket.referenceLink} target="_blank" rel="noopener noreferrer" className="underline" style={{ color: "var(--teal)" }}>{ticket.referenceLink}</a>
                </div>
              )}
              {isLead && (
                <div className="flex flex-wrap gap-2 items-center mt-2">
                  <input type="number" min="1" value={unitsInput} onChange={(e) => setUnitsInput(e.target.value)} className="w-20 border rounded px-2 py-1 text-xs" style={{ borderColor: "var(--line)" }} />
                  <button onClick={saveUnits} className="px-2 py-1 rounded text-xs font-semibold border" style={{ borderColor: "var(--line)" }}>Correct units</button>
                  <input type="url" value={refLinkInput} onChange={(e) => setRefLinkInput(e.target.value)} placeholder="https://…" className="border rounded px-2 py-1 text-xs" style={{ borderColor: "var(--line)" }} />
                  <button onClick={saveRefLink} className="px-2 py-1 rounded text-xs font-semibold border" style={{ borderColor: "var(--line)" }}>Correct link</button>
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
                    <b className="uppercase" style={{ color: r.type === "major" ? "var(--coral)" : "var(--amber)" }}>{r.type}</b>{r.category && <span style={{ color: "var(--muted)" }}> · {r.category}</span>} — {r.note} <span style={{ color: "var(--muted)" }}>({r.taggedBy})</span>
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
  const reportRef = useRef(null);
  const [reportTab, setReportTab] = useState("completed"); // "completed" | "ongoing"
  const [periodType, setPeriodType] = useState("monthly"); // "monthly" | "daily" | "range"
  const [month, setMonth] = useState(monthKey(todayISO()));
  const [day, setDay] = useState(todayISO());
  const [rangeStart, setRangeStart] = useState(todayISO());
  const [rangeEnd, setRangeEnd] = useState(todayISO());
  const [exportingPdf, setExportingPdf] = useState(false);
  const [purposeChartType, setPurposeChartType] = useState("pie"); // "pie" | "bar"
  const [categoryChartType, setCategoryChartType] = useState("bar"); // "bar" | "pie"

  const inPeriod = (dateStr) => {
    if (!dateStr) return false;
    if (periodType === "monthly") return monthKey(dateStr) === month;
    if (periodType === "daily") return dateStr === day;
    return dateStr >= rangeStart && dateStr <= rangeEnd;
  };
  const periodLabel = periodType === "monthly" ? month : periodType === "daily" ? day : `${rangeStart}_to_${rangeEnd}`;
  const periodLabelReadable = periodType === "monthly" ? month : periodType === "daily" ? day : `${rangeStart} to ${rangeEnd}`;

  const completedInPeriod = tickets.filter((t) => t.status === "Completed" && inPeriod(t.dateCompleted));
  const requestedInPeriod = tickets.filter((t) => inPeriod(t.dateRequested));

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

  // Previous-period comparison ("vs last month" / "vs yesterday") — only
  // meaningful for monthly/daily modes, since a custom range has no fixed
  // equivalent "previous" range to compare against.
  const prevPeriodKey = periodType === "monthly"
    ? (() => { const b = new Date(month + "-01"); return new Date(b.getFullYear(), b.getMonth() - 1, 1).toISOString().slice(0, 7); })()
    : periodType === "daily"
    ? (() => { const b = new Date(day + "T00:00:00"); b.setDate(b.getDate() - 1); return b.toISOString().slice(0, 10); })()
    : null;
  const completedInPrevPeriod = prevPeriodKey
    ? tickets.filter((t) => t.status === "Completed" && (periodType === "monthly" ? monthKey(t.dateCompleted) === prevPeriodKey : t.dateCompleted === prevPeriodKey))
    : [];
  const prevAccs = completedInPrevPeriod.map(ticketAccuracy).filter((a) => a !== null);
  const prevAvgAcc = prevAccs.length ? Math.round(prevAccs.reduce((a, b) => a + b, 0) / prevAccs.length) : null;
  const prevAvgRev = completedInPrevPeriod.length ? completedInPrevPeriod.reduce((s, t) => s + revisionEquivalent(t), 0) / completedInPrevPeriod.length : 0;
  const prevTotalUnits = completedInPrevPeriod.reduce((s, t) => s + (t.units || 0), 0);
  const pctChange = (curr, prev) => {
    if (prevPeriodKey === null) return null;
    if (!prev) return curr > 0 ? 100 : 0;
    return Math.round(((curr - prev) / prev) * 100);
  };
  const trendLabel = periodType === "daily" ? "vs yesterday" : "vs last month";

  // Revision category analytics — every revision logged in the period,
  // across all tickets (not just completed ones), grouped by category.
  const revisionsInPeriod = tickets.flatMap((t) => t.revisions.map((r) => ({ ...r, ticketNo: t.ticketNo }))).filter((r) => inPeriod((r.date || "").slice(0, 10)));
  const revisionsByCategory = REVISION_CATEGORIES
    .map((c) => ({
      name: c,
      minor: revisionsInPeriod.filter((r) => (r.category || "Other") === c && r.type === "minor").length,
      major: revisionsInPeriod.filter((r) => (r.category || "Other") === c && r.type === "major").length,
    }))
    .map((row) => ({ ...row, total: row.minor + row.major }))
    .filter((row) => row.total > 0)
    .sort((a, b) => b.total - a.total);
  const topRevisionCategory = revisionsByCategory[0] || null;

  // Creative output by category — weighted by units produced (not just
  // ticket count), so a project the lead marked as 3 units counts as 3
  // toward its content type, matching the actual output volume.
  const byCreativeCategory = CONTENT_TYPES
    .map((c) => ({ name: c, units: completedInPeriod.filter((t) => t.contentType === c).reduce((s, t) => s + (t.units || 0), 0) }))
    .filter((row) => row.units > 0)
    .sort((a, b) => b.units - a.units);
  const staticUnits = completedInPeriod.filter((t) => contentSuperType(t.contentType) === "Static").reduce((s, t) => s + (t.units || 0), 0);
  const videoUnits = completedInPeriod.filter((t) => contentSuperType(t.contentType) === "Video").reduce((s, t) => s + (t.units || 0), 0);

  const purposeTagsInPeriod = requestedInPeriod.flatMap((t) => getPurposes(t));
  const byPurpose = PURPOSES.map((p) => ({ name: p, value: purposeTagsInPeriod.filter((x) => x === p).length })).filter((p) => p.value > 0);
  const purposeTotal = byPurpose.reduce((s, p) => s + p.value, 0);

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
  const daysBetween = (start, end) => {
    if (!start) return null;
    const s = new Date(start + "T00:00:00");
    const e = end ? new Date(end + "T00:00:00") : new Date(todayISO() + "T00:00:00");
    return Math.max(0, Math.round((e - s) / 86400000));
  };

  const trend = useMemo(() => {
    if (periodType === "daily") {
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
    }
    if (periodType === "range") return null; // trend line doesn't apply to an arbitrary custom range
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
  }, [tickets, month, day, periodType]);

  const priorityBreakdown = PRIORITIES.map((p) => ({ name: p, value: tickets.filter((t) => t.priority === p && t.status !== "Completed").length }));

  const exportPdf = async () => {
    if (!reportRef.current) return;
    setExportingPdf(true);
    try {
      const canvas = await html2canvas(reportRef.current, { scale: 2, backgroundColor: "#ffffff", useCORS: true });
      const imgData = canvas.toDataURL("image/png");
      const pdf = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const imgWidth = pageWidth;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;
      let heightLeft = imgHeight;
      let position = 0;
      pdf.addImage(imgData, "PNG", 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;
      while (heightLeft > 0) {
        position = heightLeft - imgHeight;
        pdf.addPage();
        pdf.addImage(imgData, "PNG", 0, position, imgWidth, imgHeight);
        heightLeft -= pageHeight;
      }
      pdf.save(`job-docket-report-${periodLabel}.pdf`);
    } catch (e) {
      window.alert("PDF export failed. Try again, or use the CSV export instead.");
    }
    setExportingPdf(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex border rounded overflow-hidden w-fit" style={{ borderColor: "var(--line)" }}>
          <button onClick={() => setReportTab("completed")} className="px-4 py-1.5 text-xs font-semibold" style={{ background: reportTab === "completed" ? "var(--ink)" : "white", color: reportTab === "completed" ? "white" : "var(--ink)" }}>Completed Report</button>
          <button onClick={() => setReportTab("ongoing")} className="px-4 py-1.5 text-xs font-semibold" style={{ background: reportTab === "ongoing" ? "var(--ink)" : "white", color: reportTab === "ongoing" ? "white" : "var(--ink)" }}>Ongoing Projects</button>
        </div>
        <button onClick={exportPdf} disabled={exportingPdf} className="flex items-center gap-1.5 px-3 py-1.5 rounded text-white text-xs font-semibold disabled:opacity-50" style={{ background: "var(--coral)" }}>
          <Download size={13} /> {exportingPdf ? "Generating…" : "Export PDF (with charts) — for email"}
        </button>
      </div>

      {reportTab === "ongoing" ? (
        <div className="space-y-6" ref={reportRef}>
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

          <div className="bg-white border rounded-md p-4" style={{ borderColor: "var(--line)" }}>
            <SectionTitle>Ongoing projects — full list</SectionTitle>
            {overallOngoing.length === 0 ? (
              <EmptyState text="Nothing ongoing right now." />
            ) : (
              <table className="w-full text-sm mt-3">
                <thead>
                  <tr className="text-left text-xs uppercase" style={{ color: "var(--muted)" }}>
                    <th className="pb-2">Job</th><th className="pb-2">Title</th><th className="pb-2">Assigned to</th><th className="pb-2">Status</th><th className="pb-2">Days running</th>
                  </tr>
                </thead>
                <tbody>
                  {[...overallOngoing].sort((a, b) => daysBetween(b.dateRequested) - daysBetween(a.dateRequested)).map((t) => {
                    const days = daysBetween(t.dateRequested);
                    const overdue = t.dueDate && t.status !== "On Hold" && t.dueDate < todayISO();
                    return (
                      <tr key={t.id} className="border-t" style={{ borderColor: "var(--line)" }}>
                        <td className="py-1.5" style={{ fontFamily: "var(--font-mono)", color: "var(--muted)" }}>JOB-{String(t.ticketNo).padStart(4, "0")}</td>
                        <td className="py-1.5 font-medium">{t.title}</td>
                        <td className="py-1.5">{nameOf(roster, t.assignedTo)}</td>
                        <td className="py-1.5"><StatusPill status={t.status} /></td>
                        <td className="py-1.5" style={{ color: overdue ? "var(--coral)" : "var(--ink)" }}>{days} {days === 1 ? "day" : "days"}{overdue ? " (overdue)" : ""}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      ) : (
      <div className="space-y-6" ref={reportRef}>
      <div className="flex flex-wrap items-center gap-3">
        <SectionTitle>Report period</SectionTitle>
        <div className="flex border rounded overflow-hidden" style={{ borderColor: "var(--line)" }}>
          <button onClick={() => setPeriodType("monthly")} className="px-3 py-1 text-xs font-semibold" style={{ background: periodType === "monthly" ? "var(--ink)" : "white", color: periodType === "monthly" ? "white" : "var(--ink)" }}>Monthly</button>
          <button onClick={() => setPeriodType("daily")} className="px-3 py-1 text-xs font-semibold" style={{ background: periodType === "daily" ? "var(--ink)" : "white", color: periodType === "daily" ? "white" : "var(--ink)" }}>Daily</button>
          <button onClick={() => setPeriodType("range")} className="px-3 py-1 text-xs font-semibold" style={{ background: periodType === "range" ? "var(--ink)" : "white", color: periodType === "range" ? "white" : "var(--ink)" }}>Custom Range</button>
        </div>
        {periodType === "monthly" && (
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="border rounded px-2 py-1 text-sm" style={{ borderColor: "var(--line)" }} />
        )}
        {periodType === "daily" && (
          <input type="date" value={day} onChange={(e) => setDay(e.target.value)} className="border rounded px-2 py-1 text-sm" style={{ borderColor: "var(--line)" }} />
        )}
        {periodType === "range" && (
          <div className="flex items-center gap-1.5 text-sm">
            <input type="date" value={rangeStart} onChange={(e) => setRangeStart(e.target.value)} className="border rounded px-2 py-1 text-sm" style={{ borderColor: "var(--line)" }} />
            <span style={{ color: "var(--muted)" }}>to</span>
            <input type="date" value={rangeEnd} onChange={(e) => setRangeEnd(e.target.value)} className="border rounded px-2 py-1 text-sm" style={{ borderColor: "var(--line)" }} />
          </div>
        )}
        <button onClick={() => downloadCSV(ticketsToCSV(completedInPeriod, roster), `job-docket-report-${periodLabel}.csv`)} className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold border" style={{ borderColor: "var(--line)" }}>
          <Download size={13} /> Export {periodLabelReadable} CSV
        </button>
        <button onClick={() => downloadCSV(ticketsToCSV(tickets, roster), `job-docket-all-data.csv`)} className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold border" style={{ borderColor: "var(--line)" }}>
          <Download size={13} /> Export all data CSV
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        <StatCard label="Requests logged" value={requestedInPeriod.length} icon={FilePlus2} />
        <StatCard label="Completed" value={completedInPeriod.length} icon={CheckCircle2} trendPct={pctChange(completedInPeriod.length, completedInPrevPeriod.length)} trendLabel={trendLabel} />
        <StatCard label="Units produced" value={orgTotalUnits} icon={Pencil} trendPct={pctChange(orgTotalUnits, prevTotalUnits)} trendLabel={trendLabel} />
        <StatCard label="Avg accuracy" value={orgAvgAcc ?? "—"} icon={BarChart3} trendPct={pctChange(orgAvgAcc || 0, prevAvgAcc || 0)} trendLabel={trendLabel} />
        <StatCard label="Avg revisions" value={orgAvgRev.toFixed(2)} icon={Pencil} trendPct={pctChange(orgAvgRev, prevAvgRev)} trendLabel={trendLabel} invertTrend />
        <StatCard label="Open priority items" value={tickets.filter((t) => t.status !== "Completed" && (t.priority === "High" || t.priority === "Urgent")).length} icon={Flag} />
      </div>

      <div className="bg-white border rounded-md p-4" style={{ borderColor: "var(--line)" }}>
        <SectionTitle>Per team member — {periodLabelReadable}</SectionTitle>
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
          <SectionTitle>Completed per member — {periodLabelReadable}</SectionTitle>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={perArtist}>
              <CartesianGrid stroke="var(--line)" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-15} textAnchor="end" height={50} />
              <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="completed" fill="var(--amber)" radius={[3, 3, 0, 0]} label={{ position: "top" }} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        {trend && (
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
        )}
      </div>

      <div className="bg-white border rounded-md p-4" style={{ borderColor: "var(--line)" }}>
        <SectionTitle>Revision categories — {periodLabelReadable} ({revisionsInPeriod.length} revisions logged)</SectionTitle>
        {revisionsByCategory.length === 0 ? (
          <EmptyState text="No revisions logged in this period." />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 mt-3 mb-1">
              <StatCard label="Trending category" value={topRevisionCategory ? topRevisionCategory.name : "—"} icon={Trophy} />
              <StatCard label="Overall combined avg. revisions/project" value={orgAvgRev.toFixed(2)} icon={Pencil} />
            </div>
            <ResponsiveContainer width="100%" height={Math.max(160, revisionsByCategory.length * 34)}>
              <BarChart data={revisionsByCategory} layout="vertical" margin={{ left: 20 }}>
                <CartesianGrid stroke="var(--line)" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={140} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="minor" stackId="a" fill="var(--amber)" name="Minor" radius={[0, 0, 0, 0]} />
                <Bar dataKey="major" stackId="a" fill="var(--coral)" name="Major" radius={[0, 3, 3, 0]} />
              </BarChart>
            </ResponsiveContainer>
            <table className="w-full text-sm mt-4">
              <thead>
                <tr className="text-left text-xs uppercase" style={{ color: "var(--muted)" }}>
                  <th className="pb-2">Category</th><th className="pb-2">Minor</th><th className="pb-2">Major</th><th className="pb-2">Total</th>
                </tr>
              </thead>
              <tbody>
                {revisionsByCategory.map((row) => (
                  <tr key={row.name} className="border-t" style={{ borderColor: "var(--line)" }}>
                    <td className="py-1.5 font-medium">{row.name}</td>
                    <td className="py-1.5">{row.minor}</td>
                    <td className="py-1.5">{row.major}</td>
                    <td className="py-1.5 font-semibold">{row.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div className="bg-white border rounded-md p-4" style={{ borderColor: "var(--line)" }}>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <SectionTitle>Creative output by category — {periodLabelReadable} (units)</SectionTitle>
            <ChartTypeToggle value={categoryChartType} onChange={setCategoryChartType} options={[{ id: "bar", label: "Bar" }, { id: "pie", label: "Pie" }]} />
          </div>
          <div className="flex gap-4 mt-3 mb-2">
            <StatCard label="Static units" value={staticUnits} icon={ImageIcon} />
            <StatCard label="Video units" value={videoUnits} icon={ImageIcon} />
          </div>
          {byCreativeCategory.length === 0 ? (
            <EmptyState text="No completed units in this period yet." />
          ) : categoryChartType === "bar" ? (
            <ResponsiveContainer width="100%" height={Math.max(160, byCreativeCategory.length * 32)}>
              <BarChart data={byCreativeCategory} layout="vertical" margin={{ left: 10, right: 20 }}>
                <CartesianGrid stroke="var(--line)" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={170} />
                <Tooltip />
                <Bar dataKey="units" fill="var(--teal)" radius={[0, 3, 3, 0]} label={{ position: "right" }} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie data={byCreativeCategory} dataKey="units" nameKey="name" outerRadius={85} label={(e) => `${e.name}: ${e.units}`}>
                  {byCreativeCategory.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>
        <div className="bg-white border rounded-md p-4" style={{ borderColor: "var(--line)" }}>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <SectionTitle>Requests by purpose — {periodLabelReadable} ({purposeTotal} total)</SectionTitle>
            <ChartTypeToggle value={purposeChartType} onChange={setPurposeChartType} options={[{ id: "pie", label: "Pie" }, { id: "bar", label: "Bar" }]} />
          </div>
          {byPurpose.length === 0 ? (
            <EmptyState text="No requests logged in this period." />
          ) : purposeChartType === "pie" ? (
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie data={byPurpose} dataKey="value" nameKey="name" outerRadius={80} label={(e) => `${e.name}: ${e.value}`}>
                  {byPurpose.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                </Pie>
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={byPurpose}>
                <CartesianGrid stroke="var(--line)" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="value" fill="var(--teal)" radius={[3, 3, 0, 0]} label={{ position: "top" }} />
              </BarChart>
            </ResponsiveContainer>
          )}
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

      <div className="bg-white border rounded-md p-4" style={{ borderColor: "var(--line)" }}>
        <SectionTitle>Completed projects — {periodLabelReadable} — full list</SectionTitle>
        {completedInPeriod.length === 0 ? (
          <EmptyState text="Nothing completed in this period." />
        ) : (
          <table className="w-full text-sm mt-3">
            <thead>
              <tr className="text-left text-xs uppercase" style={{ color: "var(--muted)" }}>
                <th className="pb-2">Job</th><th className="pb-2">Title</th><th className="pb-2">Assigned to</th><th className="pb-2">Days to complete</th><th className="pb-2">Units</th>
              </tr>
            </thead>
            <tbody>
              {[...completedInPeriod].sort((a, b) => new Date(b.dateCompleted) - new Date(a.dateCompleted)).map((t) => (
                <tr key={t.id} className="border-t" style={{ borderColor: "var(--line)" }}>
                  <td className="py-1.5" style={{ fontFamily: "var(--font-mono)", color: "var(--muted)" }}>JOB-{String(t.ticketNo).padStart(4, "0")}</td>
                  <td className="py-1.5 font-medium">{t.title}</td>
                  <td className="py-1.5">{nameOf(roster, t.assignedTo)}</td>
                  <td className="py-1.5">{daysBetween(t.dateRequested, t.dateCompleted)} days</td>
                  <td className="py-1.5">{t.units || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      </div>
      )}
    </div>
  );
}

function TeamHub(props) {
  const [sub, setSub] = useState("profiles");
  const subtabs = [
    { id: "profiles", label: "Profiles", icon: Heart },
    { id: "chat", label: "Chat", icon: MessageSquarePlus },
    { id: "music", label: "Music Corner", icon: Music },
    { id: "roster", label: "Roster & Settings", icon: Users },
  ];
  return (
    <div>
      <div className="flex gap-1 mb-4 border rounded-md p-1 w-fit" style={{ borderColor: "var(--line)", background: "white" }}>
        {subtabs.map((t) => {
          const Icon = t.icon;
          const active = sub === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setSub(t.id)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-semibold"
              style={{ background: active ? "var(--ink)" : "transparent", color: active ? "white" : "var(--muted)" }}
            >
              <Icon size={14} /> {t.label}
            </button>
          );
        })}
      </div>

      {sub === "profiles" && (
        <TeamSpaceView
          roster={props.roster}
          currentUser={props.currentUser}
          isLead={props.isLead}
          isAdmin={props.isAdmin}
          endorsements={props.endorsements}
          addEndorsement={props.addEndorsement}
          deleteEndorsement={props.deleteEndorsement}
          saveRoster={props.saveRoster}
          tickets={props.tickets}
          galleryItems={props.galleryItems}
          addGalleryItem={props.addGalleryItem}
          removeGalleryItem={props.removeGalleryItem}
        />
      )}
      {sub === "chat" && (
        <ChatView
          messages={props.chatMessages}
          roster={props.roster}
          currentUser={props.currentUser}
          isLead={props.isLead}
          sendMessage={props.sendChatMessage}
          deleteMessage={props.deleteChatMessage}
        />
      )}
      {sub === "music" && (
        <MusicCornerView
          tracks={props.musicTracks}
          roster={props.roster}
          currentUser={props.currentUser}
          isAdmin={props.isAdmin}
          addMusicTrack={props.addMusicTrack}
          removeMusicTrack={props.removeMusicTrack}
        />
      )}
      {sub === "roster" && (
        <TeamView
          roster={props.roster}
          saveRoster={props.saveRoster}
          wallpaperUrl={props.wallpaperUrl}
          saveWallpaper={props.saveWallpaper}
          clearWallpaper={props.clearWallpaper}
          logoUrl={props.logoUrl}
          saveLogo={props.saveLogo}
          clearLogo={props.clearLogo}
          appTagline={props.appTagline}
          saveTagline={props.saveTagline}
          exportBackup={props.exportBackup}
          restoreBackup={props.restoreBackup}
          isLead={props.isLead}
          isAdmin={props.isAdmin}
        />
      )}
    </div>
  );
}

function TeamSpaceView({ roster, currentUser, isLead, isAdmin, endorsements, addEndorsement, deleteEndorsement, saveRoster, tickets, galleryItems, addGalleryItem, removeGalleryItem }) {
  const [selectedId, setSelectedId] = useState(roster[0]?.id || "");
  const [message, setMessage] = useState("");
  const [editingBio, setEditingBio] = useState(false);
  const [profileWallpaper, setProfileWallpaper] = useState(null);
  const [pendingHasWallpaper, setPendingHasWallpaper] = useState(false);
  const [form, setForm] = useState({ bio: "", likes: "", mobile: "", email: "", favoriteFood: "", favoriteMusic: "", wishlist: "", quote: "" });

  const selected = roster.find((m) => m.id === selectedId) || roster[0];
  const isSelf = selected && currentUser && selected.id === currentUser.id;
  const canEdit = isSelf || isAdmin;
  // Private by design: a message only shows to the person it was sent to,
  // the person who sent it, or Admin. Nobody else sees it — even when
  // browsing someone else's profile.
  const mine = endorsements
    .filter((e) => e.toMemberId === selected?.id)
    .filter((e) => isAdmin || e.toMemberId === currentUser?.id || e.fromId === currentUser?.id)
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  useEffect(() => {
    if (selected) {
      setForm({
        bio: selected.bio || "", likes: selected.likes || "", mobile: selected.mobile || "",
        email: selected.email || "", favoriteFood: selected.favoriteFood || "", favoriteMusic: selected.favoriteMusic || "",
        wishlist: selected.wishlist || "", quote: selected.quote || "",
      });
      setPendingHasWallpaper(!!selected.hasProfileWallpaper);
      if (selected.hasProfileWallpaper) loadProfileWallpaper(selected.id).then(setProfileWallpaper);
      else setProfileWallpaper(null);
    }
    setEditingBio(false);
  }, [selected?.id, selected?.hasProfileWallpaper]);

  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  // Wallpaper flag is saved together with the rest of the profile fields in
  // one write (not as a separate save call) so a photo upload followed
  // quickly by "Save" can never overwrite each other.
  const saveProfile = () => {
    saveRoster(roster.map((m) => (m.id === selected.id ? { ...m, ...form, hasProfileWallpaper: pendingHasWallpaper } : m)));
    setEditingBio(false);
  };

  const handleProfileWallpaper = async (file) => {
    if (!file) return;
    const compressed = await compressImage(file, 1200, 0.75);
    try {
      await saveProfileWallpaper(selected.id, compressed);
      setProfileWallpaper(compressed);
      setPendingHasWallpaper(true);
    } catch (e) {
      window.alert("Wallpaper upload failed — try a smaller image.");
    }
  };
  const clearProfileWallpaper = async () => {
    await removeProfileWallpaper(selected.id);
    setProfileWallpaper(null);
    setPendingHasWallpaper(false);
  };

  const [galleryCaption, setGalleryCaption] = useState("");
  const [lightbox, setLightbox] = useState(null);
  const [statsPeriodType, setStatsPeriodType] = useState("monthly"); // "monthly" | "daily"
  const [statsMonth, setStatsMonth] = useState(monthKey(todayISO()));
  const [statsDay, setStatsDay] = useState(todayISO());

  const myGallery = galleryItems.filter((g) => g.memberId === selected?.id).sort((a, b) => new Date(b.date) - new Date(a.date));

  const handleGalleryUpload = async (file) => {
    if (!file || !selected) return;
    const compressed = await compressImage(file, 1000, 0.75);
    await addGalleryItem(selected.id, compressed, galleryCaption);
    setGalleryCaption("");
  };

  const statsPeriodLabel = statsPeriodType === "monthly" ? statsMonth : statsDay;
  const inStatsPeriod = (isoDate) => {
    if (!isoDate) return false;
    return statsPeriodType === "monthly" ? monthKey(isoDate) === statsMonth : isoDate === statsDay;
  };
  const myTickets = tickets.filter((t) => t.assignedTo === selected?.id);
  const myRequests = tickets.filter((t) => t.requestedBy === selected?.id);
  const stats = {
    completedInPeriod: myTickets.filter((t) => t.status === "Completed" && inStatsPeriod(t.dateCompleted)).length,
    completedAllTime: myTickets.filter((t) => t.status === "Completed").length,
    ongoing: myTickets.filter((t) => !CLOSED_STATUSES.includes(t.status)).length,
    requestsInPeriod: myRequests.filter((t) => inStatsPeriod(t.dateRequested)).length,
    requestsAllTime: myRequests.length,
  };


  const submitMessage = () => {
    if (!message.trim() || !selected) return;
    addEndorsement(selected.id, message);
    setMessage("");
  };

  if (!selected) return <EmptyState text="Add team members first, in the Team tab." />;

  const cardBg = profileWallpaper
    ? { backgroundImage: `url(${profileWallpaper})`, backgroundSize: "cover", backgroundPosition: "center" }
    : { background: "linear-gradient(135deg, var(--ink), var(--teal))" };

  return (
    <div className="grid md:grid-cols-4 gap-4">
      <div className="md:col-span-1 flex md:flex-col gap-1 overflow-x-auto">
        {roster.map((m) => (
          <button
            key={m.id}
            onClick={() => setSelectedId(m.id)}
            className="flex items-center gap-2 px-2.5 py-2 rounded text-sm font-medium text-left whitespace-nowrap"
            style={{ background: selectedId === m.id ? "var(--ink)" : "white", color: selectedId === m.id ? "white" : "var(--ink)", border: "1px solid var(--line)" }}
          >
            <Avatar member={m} size={22} /> {m.name}
          </button>
        ))}
      </div>

      <div className="md:col-span-3 space-y-4">
        <div className="border rounded-md overflow-hidden" style={{ borderColor: "var(--line)" }}>
          <div className="h-56 sm:h-72" style={cardBg} />
          <div className="bg-white px-4 pb-4 relative">
            <div className="-mt-14 flex items-end gap-3 mb-2">
              <div className="rounded-full" style={{ border: "5px solid white", background: "white" }}>
                <Avatar member={selected} size={100} />
              </div>
              <div className="pb-1">
                <div className="font-black text-xl leading-tight" style={{ fontFamily: "var(--font-display)" }}>{selected.name}</div>
                <div className="text-xs" style={{ color: "var(--muted)" }}>{selected.role} · {selected.dept}</div>
              </div>
            </div>

            {canEdit && !editingBio && (
              <button onClick={() => setEditingBio(true)} className="flex items-center gap-1 text-xs font-semibold mb-3" style={{ color: "var(--teal)" }}>
                <Pencil size={12} /> {isSelf ? "Edit my profile" : `Edit ${selected.name}'s profile (Admin)`}
              </button>
            )}

            {!editingBio ? (
              <div className="text-sm space-y-2">
                <div>{selected.bio || <span style={{ color: "var(--muted)" }}>No bio yet.</span>}</div>
                {selected.quote && <div className="italic text-sm" style={{ color: "var(--muted)" }}>"{selected.quote}"</div>}
                <div className="grid sm:grid-cols-2 gap-x-4 gap-y-1 text-xs pt-2" style={{ color: "var(--muted)" }}>
                  {selected.likes && <div><b style={{ color: "var(--ink)" }}>Likes:</b> {selected.likes}</div>}
                  {selected.favoriteFood && <div><b style={{ color: "var(--ink)" }}>Favorite food:</b> {selected.favoriteFood}</div>}
                  {selected.favoriteMusic && <div><b style={{ color: "var(--ink)" }}>Favorite music:</b> {selected.favoriteMusic}</div>}
                  {selected.wishlist && <div><b style={{ color: "var(--ink)" }}>Wishlist:</b> {selected.wishlist}</div>}
                  {selected.mobile && <div><b style={{ color: "var(--ink)" }}>Mobile:</b> {selected.mobile}</div>}
                  {selected.email && <div><b style={{ color: "var(--ink)" }}>Email:</b> {selected.email}</div>}
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <Field label="Profile wallpaper (optional)">
                  <input type="file" accept="image/*" onChange={(e) => handleProfileWallpaper(e.target.files?.[0])} className="text-sm" />
                  {profileWallpaper && (
                    <button onClick={clearProfileWallpaper} className="ml-2 text-xs font-semibold" style={{ color: "var(--coral)" }}>Remove</button>
                  )}
                </Field>
                <Field label="Bio">
                  <textarea value={form.bio} onChange={(e) => setField("bio", e.target.value)} rows={3} className="w-full border rounded px-2 py-1.5 text-sm" style={{ borderColor: "var(--line)" }} placeholder="A little about you…" />
                </Field>
                <Field label="Favorite quote">
                  <input value={form.quote} onChange={(e) => setField("quote", e.target.value)} className="w-full border rounded px-2 py-1.5 text-sm" style={{ borderColor: "var(--line)" }} />
                </Field>
                <div className="grid sm:grid-cols-2 gap-3">
                  <Field label="Likes / interests">
                    <input value={form.likes} onChange={(e) => setField("likes", e.target.value)} className="w-full border rounded px-2 py-1.5 text-sm" style={{ borderColor: "var(--line)" }} placeholder="Coffee, retro games, hiking…" />
                  </Field>
                  <Field label="Favorite food">
                    <input value={form.favoriteFood} onChange={(e) => setField("favoriteFood", e.target.value)} className="w-full border rounded px-2 py-1.5 text-sm" style={{ borderColor: "var(--line)" }} />
                  </Field>
                  <Field label="Favorite music (artist/song name)">
                    <input value={form.favoriteMusic} onChange={(e) => setField("favoriteMusic", e.target.value)} className="w-full border rounded px-2 py-1.5 text-sm" style={{ borderColor: "var(--line)" }} placeholder="Artists, genres, a song…" />
                  </Field>
                  <Field label="Wishlist">
                    <input value={form.wishlist} onChange={(e) => setField("wishlist", e.target.value)} className="w-full border rounded px-2 py-1.5 text-sm" style={{ borderColor: "var(--line)" }} />
                  </Field>
                  <Field label="Mobile number">
                    <input value={form.mobile} onChange={(e) => setField("mobile", e.target.value)} className="w-full border rounded px-2 py-1.5 text-sm" style={{ borderColor: "var(--line)" }} />
                  </Field>
                  <Field label="Email">
                    <input type="email" value={form.email} onChange={(e) => setField("email", e.target.value)} className="w-full border rounded px-2 py-1.5 text-sm" style={{ borderColor: "var(--line)" }} />
                  </Field>
                </div>
                <div className="flex gap-2">
                  <button onClick={saveProfile} className="flex items-center gap-1 px-3 py-1.5 rounded text-white text-xs font-semibold" style={{ background: "var(--ink)" }}><Save size={13} /> Save</button>
                  <button onClick={() => setEditingBio(false)} className="px-3 py-1.5 rounded text-xs font-semibold border" style={{ borderColor: "var(--line)" }}>Cancel</button>
                </div>
                <div className="text-[11px]" style={{ color: "var(--muted)" }}>Contact details are visible to the whole team, not just you.</div>
              </div>
            )}
        </div>
        </div>

        <div className="bg-white border rounded-md p-4" style={{ borderColor: "var(--line)" }}>
          <div className="flex flex-wrap items-center gap-3">
            <SectionTitle>Productivity — {selected.name}</SectionTitle>
            <div className="flex border rounded overflow-hidden" style={{ borderColor: "var(--line)" }}>
              <button onClick={() => setStatsPeriodType("monthly")} className="px-2.5 py-1 text-xs font-semibold" style={{ background: statsPeriodType === "monthly" ? "var(--ink)" : "white", color: statsPeriodType === "monthly" ? "white" : "var(--ink)" }}>Monthly</button>
              <button onClick={() => setStatsPeriodType("daily")} className="px-2.5 py-1 text-xs font-semibold" style={{ background: statsPeriodType === "daily" ? "var(--ink)" : "white", color: statsPeriodType === "daily" ? "white" : "var(--ink)" }}>Daily</button>
            </div>
            {statsPeriodType === "monthly" ? (
              <input type="month" value={statsMonth} onChange={(e) => setStatsMonth(e.target.value)} className="border rounded px-2 py-1 text-xs" style={{ borderColor: "var(--line)" }} />
            ) : (
              <input type="date" value={statsDay} onChange={(e) => setStatsDay(e.target.value)} className="border rounded px-2 py-1 text-xs" style={{ borderColor: "var(--line)" }} />
            )}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
            <StatCard label={`Completed (${statsPeriodLabel})`} value={stats.completedInPeriod} icon={CheckCircle2} />
            <StatCard label="Ongoing / pending" value={stats.ongoing} icon={KanbanSquare} />
            <StatCard label={`Requests made (${statsPeriodLabel})`} value={stats.requestsInPeriod} icon={FilePlus2} />
            <StatCard label="Completed (all-time)" value={stats.completedAllTime} icon={Trophy} />
          </div>
        </div>

        <div className="bg-white border rounded-md p-4" style={{ borderColor: "var(--line)" }}>
          <SectionTitle>Most memorable projects</SectionTitle>
          {canEdit && (
            <div className="flex flex-wrap gap-2 mt-2 items-center">
              <input value={galleryCaption} onChange={(e) => setGalleryCaption(e.target.value)} placeholder="Caption (optional)…" className="border rounded px-2 py-1.5 text-sm flex-1 min-w-[140px]" style={{ borderColor: "var(--line)" }} />
              <label className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold border cursor-pointer" style={{ borderColor: "var(--line)" }}>
                <Upload size={13} /> Add photo
                <input type="file" accept="image/*" className="hidden" onChange={(e) => handleGalleryUpload(e.target.files?.[0])} />
              </label>
            </div>
          )}
          {myGallery.length === 0 ? (
            <EmptyState text="No memorable projects added yet." />
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 mt-3">
              {myGallery.map((g) => (
                <div key={g.id} className="relative group">
                  <button onClick={() => setLightbox(g)} className="w-full">
                    <img src={g.dataUrl} alt={g.caption || "memorable project"} className="w-full h-28 object-cover rounded border" style={{ borderColor: "var(--line)" }} />
                  </button>
                  {g.caption && <div className="text-[11px] mt-1 truncate" style={{ color: "var(--muted)" }}>{g.caption}</div>}
                  {canEdit && (
                    <button onClick={() => removeGalleryItem(g.id)} className="absolute top-1 right-1 bg-black/60 rounded-full p-0.5">
                      <X size={12} color="white" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white border rounded-md p-4" style={{ borderColor: "var(--line)" }}>
          <SectionTitle>Private messages & endorsements</SectionTitle>
          <div className="text-[11px] mb-2" style={{ color: "var(--muted)" }}>Visible only to {selected.name} and Admin — not the rest of the team.</div>
          {!isSelf && (
            <div className="flex gap-2 mt-2">
              <input value={message} onChange={(e) => setMessage(e.target.value)} placeholder={`Leave a private message for ${selected.name}…`} className="flex-1 border rounded px-2 py-1.5 text-sm" style={{ borderColor: "var(--line)" }} />
              <button onClick={submitMessage} className="px-3 py-1.5 rounded text-white text-xs font-semibold" style={{ background: "var(--ink)" }}>Send</button>
            </div>
          )}
          <div className="mt-3 space-y-2">
            {mine.length === 0 && <div className="text-xs" style={{ color: "var(--muted)" }}>No messages yet.</div>}
            {mine.map((e) => (
              <div key={e.id} className="text-sm border-t pt-2 flex items-start justify-between gap-2" style={{ borderColor: "var(--line)" }}>
                <div>
                  {e.message}
                  <div className="text-[11px]" style={{ color: "var(--muted)" }}>— {e.fromName}, {new Date(e.date).toLocaleDateString()}</div>
                </div>
                {(isSelf || e.fromId === currentUser?.id || isAdmin) && <button onClick={() => deleteEndorsement(e.id)}><X size={13} color="var(--muted)" /></button>}
              </div>
            ))}
          </div>
        </div>
      </div>
      {lightbox && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={() => setLightbox(null)}>
          <div className="max-w-2xl w-full" onClick={(e) => e.stopPropagation()}>
            <img src={lightbox.dataUrl} alt={lightbox.caption || "memorable project"} className="w-full rounded" />
            {lightbox.caption && <div className="text-white text-sm mt-2 text-center">{lightbox.caption}</div>}
            <button onClick={() => setLightbox(null)} className="mt-2 mx-auto flex items-center gap-1 text-white text-xs font-semibold"><X size={13} /> Close</button>
          </div>
        </div>
      )}
    </div>
  );
}

function MusicCornerView({ tracks, roster, currentUser, isAdmin, addMusicTrack, removeMusicTrack }) {
  const [title, setTitle] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const MAX_MB = 15;
  const LIMIT = 3;

  const mine = tracks.filter((t) => t.memberId === currentUser?.id);
  const atLimit = mine.length >= LIMIT;
  const sorted = [...tracks].sort((a, b) => new Date(b.date) - new Date(a.date));
  const memberFor = (id) => roster.find((m) => m.id === id);
  const daysLeft = (date) => Math.max(0, 3 - Math.floor((Date.now() - new Date(date).getTime()) / 86400000));

  const handleUpload = async (file) => {
    if (!file || !currentUser) return;
    setError("");
    if (!file.type.startsWith("audio/")) { setError("That doesn't look like an audio file."); return; }
    if (file.size > MAX_MB * 1024 * 1024) { setError(`Keep it under ${MAX_MB}MB.`); return; }
    setUploading(true);
    const res = await addMusicTrack(currentUser.id, currentUser.name, title, file);
    if (res?.error) setError(res.error);
    else setTitle("");
    setUploading(false);
  };

  return (
    <div className="space-y-4">
      <div className="bg-white border rounded-md p-4" style={{ borderColor: "var(--line)" }}>
        <div className="flex items-center gap-1.5">
          <Music size={14} color="var(--teal)" />
          <SectionTitle>Music Corner — a track from anyone, for everyone</SectionTitle>
        </div>
        <div className="text-[11px] mt-1" style={{ color: "var(--muted)" }}>
          Up to {LIMIT} tracks per person, {MAX_MB}MB each. Tracks disappear automatically after 3 days, or you can remove your own anytime.
        </div>
        {currentUser && (
          <div className="mt-3">
            <div className="text-xs mb-1" style={{ color: "var(--muted)" }}>Your slots: {mine.length}/{LIMIT}</div>
            {atLimit ? (
              <div className="text-xs" style={{ color: "var(--coral)" }}>You're at your limit — remove one of your tracks below to add another.</div>
            ) : (
              <div className="flex flex-wrap gap-2 items-center">
                <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Song title (optional)" className="border rounded px-2 py-1.5 text-sm flex-1 min-w-[140px]" style={{ borderColor: "var(--line)" }} />
                <label className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold border cursor-pointer" style={{ borderColor: "var(--line)" }}>
                  <Upload size={13} /> Add track
                  <input type="file" accept="audio/*" className="hidden" onChange={(e) => handleUpload(e.target.files?.[0])} />
                </label>
              </div>
            )}
            {uploading && <div className="text-xs mt-1" style={{ color: "var(--muted)" }}>Uploading…</div>}
            {error && <div className="text-xs mt-1" style={{ color: "var(--coral)" }}>{error}</div>}
          </div>
        )}
      </div>

      {sorted.length === 0 ? (
        <EmptyState text="No tracks yet — be the first to add one." />
      ) : (
        <div className="space-y-2">
          {sorted.map((t) => {
            const member = memberFor(t.memberId);
            const canRemove = isAdmin || t.memberId === currentUser?.id;
            return (
              <div key={t.id} className="bg-white border rounded-md p-3 flex items-center gap-3" style={{ borderColor: "var(--line)" }}>
                <Avatar member={member} size={32} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold truncate">{t.title || "Untitled track"}</div>
                  <div className="text-[11px]" style={{ color: "var(--muted)" }}>
                    added by {t.memberName} · {daysLeft(t.date)} day{daysLeft(t.date) === 1 ? "" : "s"} left
                  </div>
                  <audio controls src={t.audioUrl} className="w-full mt-1" style={{ height: 32 }} />
                </div>
                {canRemove && <button onClick={() => removeMusicTrack(t)}><X size={14} color="var(--muted)" /></button>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function TeamView({ roster, saveRoster, wallpaperUrl, saveWallpaper, clearWallpaper, logoUrl, saveLogo, clearLogo, appTagline, saveTagline, exportBackup, restoreBackup, isAdmin }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("Requester");
  const [dept, setDept] = useState("Other");
  const [uploadingId, setUploadingId] = useState(null);
  const [taglineInput, setTaglineInput] = useState(appTagline || "");

  useEffect(() => { setTaglineInput(appTagline || ""); }, [appTagline]);

  const add = (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    saveRoster([...roster, { id: uid(), name, email: email.trim(), role, dept, hasPhoto: false }]);
    setName(""); setEmail("");
  };
  const update = (id, patch) => saveRoster(roster.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  const remove = (id) => saveRoster(roster.filter((m) => m.id !== id));

  const handlePhoto = async (memberId, file) => {
    if (!file) return;
    setUploadingId(memberId);
    const compressed = await compressImage(file, 300, 0.8);
    await saveAvatar(memberId, compressed);
    update(memberId, { hasPhoto: true });
    setUploadingId(null);
  };
  const handleRemovePhoto = async (memberId) => {
    await removeAvatar(memberId);
    update(memberId, { hasPhoto: false });
  };

  const handleWallpaper = async (file) => {
    if (!file) return;
    const compressed = await compressImage(file, 1600, 0.75);
    await saveWallpaper(compressed);
  };

  const handleLogo = async (file) => {
    if (!file) return;
    const compressed = await compressImage(file, 300, 0.9);
    await saveLogo(compressed);
  };

  return (
    <div className="space-y-5">
      {isAdmin && (
        <div className="bg-white border rounded-md p-4" style={{ borderColor: "var(--line)" }}>
          <SectionTitle>App branding (Admin)</SectionTitle>
          <div className="mt-3">
            <div className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: "var(--muted)" }}>Logo</div>
            <input type="file" accept="image/*" onChange={(e) => handleLogo(e.target.files?.[0])} className="text-sm" />
            {logoUrl && (
              <div className="mt-2 flex items-center gap-2">
                <img src={logoUrl} alt="logo preview" className="h-12 w-12 object-contain rounded border" style={{ borderColor: "var(--line)" }} />
                <button onClick={clearLogo} className="text-xs font-semibold px-2 py-1 rounded border" style={{ borderColor: "var(--coral)", color: "var(--coral)" }}>Remove logo</button>
              </div>
            )}
            <div className="text-[11px] mt-1" style={{ color: "var(--muted)" }}>Shows next to "Job Docket" in the header, for everyone. A square image works best.</div>
          </div>
          <div className="mt-4">
            <div className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: "var(--muted)" }}>Header tagline</div>
            <div className="flex gap-2">
              <input value={taglineInput} onChange={(e) => setTaglineInput(e.target.value)} placeholder="IPASS · Creative Production" className="flex-1 border rounded px-2 py-1.5 text-sm" style={{ borderColor: "var(--line)" }} />
              <button onClick={() => saveTagline(taglineInput)} className="px-3 py-1.5 rounded text-white text-xs font-semibold" style={{ background: "var(--ink)" }}>Save</button>
            </div>
            <div className="text-[11px] mt-1" style={{ color: "var(--muted)" }}>The small uppercase line above "Job Docket" in the header, for everyone.</div>
          </div>
        </div>
      )}

      <div className="bg-white border rounded-md p-4" style={{ borderColor: "var(--line)" }}>
        <SectionTitle>Appearance</SectionTitle>
        <div className="mt-3">
          <div className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: "var(--muted)" }}>Wallpaper image</div>
          <input type="file" accept="image/*" onChange={(e) => handleWallpaper(e.target.files?.[0])} className="text-sm" />
          {wallpaperUrl && (
            <div className="mt-2 flex items-center gap-2">
              <img src={wallpaperUrl} alt="wallpaper preview" className="h-14 rounded border" style={{ borderColor: "var(--line)" }} />
              <button onClick={clearWallpaper} className="text-xs font-semibold px-2 py-1 rounded border" style={{ borderColor: "var(--coral)", color: "var(--coral)" }}>Remove wallpaper</button>
            </div>
          )}
          <div className="text-[11px] mt-1" style={{ color: "var(--muted)" }}>Visible to the whole team.</div>
        </div>
      </div>

      <div className="bg-white border rounded-md p-4" style={{ borderColor: "var(--line)" }}>
        <SectionTitle>Backup & Restore</SectionTitle>
        <div className="flex flex-wrap gap-3 mt-3 items-center">
          <button onClick={exportBackup} className="flex items-center gap-1.5 px-3 py-1.5 rounded text-white text-xs font-semibold" style={{ background: "var(--ink)" }}>
            <Download size={13} /> Export backup (JSON)
          </button>
          {isAdmin && (
            <label className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold border cursor-pointer" style={{ borderColor: "var(--line)" }}>
              <Upload size={13} /> Restore from backup
              <input type="file" accept=".json" className="hidden" onChange={(e) => restoreBackup(e.target.files?.[0])} />
            </label>
          )}
        </div>
        <div className="text-[11px] mt-2" style={{ color: "var(--muted)" }}>
          Includes all requests, the roster, announcements, and reminders. Team photos and inspiration images are not included in the backup file — save those separately if needed. {isAdmin ? "" : "Only Admin can restore a backup."}
        </div>
      </div>

      {isAdmin && (
        <form onSubmit={add} className="bg-white border rounded-md p-4 flex flex-wrap gap-2 items-end" style={{ borderColor: "var(--line)" }}>
          <Field label="Name"><input value={name} onChange={(e) => setName(e.target.value)} className="border rounded px-2 py-1.5 text-sm" style={{ borderColor: "var(--line)" }} /></Field>
          <Field label="Login email">
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="border rounded px-2 py-1.5 text-sm" style={{ borderColor: "var(--line)" }} placeholder="must match their Firebase account" />
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
          <button className="px-3 py-1.5 rounded text-white text-sm font-semibold flex items-center gap-1" style={{ background: "var(--ink)" }}><Plus size={14} /> Add member</button>
        </form>
      )}

      <div className="bg-white border rounded-md p-4" style={{ borderColor: "var(--line)" }}>
        <SectionTitle>Team roster{!isAdmin && " (view only — Admin manages this)"}</SectionTitle>
        <table className="w-full text-sm mt-3">
          <thead>
            <tr className="text-left text-xs uppercase" style={{ color: "var(--muted)" }}><th className="pb-2">Photo</th><th className="pb-2">Color</th><th className="pb-2">Name</th><th className="pb-2">Login email</th><th className="pb-2">Role</th><th className="pb-2">Dept</th>{isAdmin && <th className="pb-2"></th>}</tr>
          </thead>
          <tbody>
            {roster.map((m) => (
              <tr key={m.id} className="border-t" style={{ borderColor: "var(--line)" }}>
                <td className="py-1.5">
                  {isAdmin ? (
                    <label className="cursor-pointer flex items-center gap-1.5">
                      <Avatar member={m} size={32} />
                      <input type="file" accept="image/*" className="hidden" onChange={(e) => handlePhoto(m.id, e.target.files?.[0])} />
                      <Pencil size={11} color="var(--muted)" />
                    </label>
                  ) : (
                    <Avatar member={m} size={32} />
                  )}
                  {uploadingId === m.id && <div className="text-[10px]" style={{ color: "var(--muted)" }}>uploading…</div>}
                  {isAdmin && m.hasPhoto && <button onClick={() => handleRemovePhoto(m.id)} className="text-[10px]" style={{ color: "var(--coral)" }}>remove</button>}
                </td>
                <td className="py-1.5">
                  {isAdmin ? (
                    <input type="color" value={m.color || memberColor(m)} onChange={(e) => update(m.id, { color: e.target.value })} className="w-8 h-7 border rounded" style={{ borderColor: "var(--line)" }} />
                  ) : (
                    <span className="inline-block rounded-full" style={{ width: 16, height: 16, background: memberColor(m) }} />
                  )}
                </td>
                <td className="py-1.5">
                  {isAdmin ? (
                    <input value={m.name} onChange={(e) => update(m.id, { name: e.target.value })} className="border rounded px-1.5 py-0.5 text-sm w-full" style={{ borderColor: "var(--line)" }} />
                  ) : m.name}
                </td>
                <td className="py-1.5">
                  {isAdmin ? (
                    <input type="email" value={m.email || ""} onChange={(e) => update(m.id, { email: e.target.value })} className="border rounded px-1.5 py-0.5 text-sm w-full" style={{ borderColor: "var(--line)" }} />
                  ) : (m.email || <span style={{ color: "var(--muted)" }}>—</span>)}
                </td>
                <td className="py-1.5">
                  {isAdmin ? (
                    <select value={m.role} onChange={(e) => update(m.id, { role: e.target.value })} className="border rounded px-1.5 py-0.5 text-sm" style={{ borderColor: "var(--line)" }}>
                      {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                  ) : m.role}
                </td>
                <td className="py-1.5">
                  {isAdmin ? (
                    <select value={m.dept} onChange={(e) => update(m.id, { dept: e.target.value })} className="border rounded px-1.5 py-0.5 text-sm" style={{ borderColor: "var(--line)" }}>
                      {DEPTS.map((d) => <option key={d} value={d}>{d}</option>)}
                    </select>
                  ) : m.dept}
                </td>
                {isAdmin && <td className="py-1.5 text-right"><button onClick={() => remove(m.id)}><Trash2 size={15} color="var(--coral)" /></button></td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
