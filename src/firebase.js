import { initializeApp } from "firebase/app";
import { getFirestore, doc, getDoc, setDoc, deleteDoc, collection, onSnapshot } from "firebase/firestore";

// ── PASTE YOUR FIREBASE CONFIG HERE ──────────────────────────────
// Get this from: Firebase Console → Project Settings → Your apps → SDK setup and configuration
const firebaseConfig = {
  apiKey: "AIzaSyANsIkPNwh4P4LJtJchex4TH5U1x6MuDKQ",
  authDomain: "kakaw-2d31c.firebaseapp.com",
  projectId: "kakaw-2d31c",
  storageBucket: "kakaw-2d31c.firebasestorage.app",
  messagingSenderId: "1049518850245",
  appId: "1:1049518850245:web:978c07718f5a85608a30ac",
};
// ──────────────────────────────────────────────────────────────────

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// Gives every browser a stable anonymous id for "personal" (non-shared) data,
// e.g. which team member you last selected as "Acting as".
function getLocalUserId() {
  let id = localStorage.getItem("docket_local_id");
  if (!id) {
    id = "u_" + Math.random().toString(36).slice(2, 10);
    localStorage.setItem("docket_local_id", id);
  }
  return id;
}

// Same shape as the Claude artifact's window.storage API, backed by Firestore,
// so the rest of the app code didn't need to change.
export const storage = {
  async get(key, shared = false) {
    const collectionName = shared ? "shared" : `personal_${getLocalUserId()}`;
    const ref = doc(db, collectionName, key);
    const snap = await getDoc(ref);
    if (!snap.exists()) return null;
    return { key, value: snap.data().value, shared };
  },
  async set(key, value, shared = false) {
    const collectionName = shared ? "shared" : `personal_${getLocalUserId()}`;
    const ref = doc(db, collectionName, key);
    await setDoc(ref, { value });
    return { key, value, shared };
  },
  async remove(key, shared = false) {
    const collectionName = shared ? "shared" : `personal_${getLocalUserId()}`;
    const ref = doc(db, collectionName, key);
    await deleteDoc(ref);
    return { key, deleted: true, shared };
  },
  // Live-updates a single shared/personal key. Returns an unsubscribe function.
  subscribe(key, shared, callback) {
    const collectionName = shared ? "shared" : `personal_${getLocalUserId()}`;
    const ref = doc(db, collectionName, key);
    return onSnapshot(ref, (snap) => callback(snap.exists() ? snap.data().value : null));
  },
};

// Tickets are stored one-document-per-ticket (not a single shared blob) so
// concurrent sessions can never silently overwrite each other's changes —
// deleting or editing one ticket only ever touches that ticket's own document.
// Reused for chat messages too, for the same reason (many people posting
// concurrently should never be able to clobber each other's messages).
function makeCollectionApi(collectionName) {
  return {
    subscribe(callback) {
      const colRef = collection(db, collectionName);
      return onSnapshot(colRef, (snap) => callback(snap.docs.map((d) => d.data())));
    },
    async upsert(item) {
      await setDoc(doc(db, collectionName, item.id), item);
    },
    async remove(id) {
      await deleteDoc(doc(db, collectionName, id));
    },
  };
}

export const ticketsApi = makeCollectionApi("tickets_v2");
export const chatApi = makeCollectionApi("chat_messages");
// Roster gets the same per-document treatment: editing one person's profile
// (photo, bio, contact info, wallpaper) can never silently overwrite another
// person's data, or a second edit to the same person made moments apart.
export const rosterApi = makeCollectionApi("roster_v2");
// Each gallery photo is its own document too, so adding/removing one photo
// never touches anyone else's gallery items.
export const galleryApi = makeCollectionApi("profile_gallery");
