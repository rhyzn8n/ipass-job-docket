import { initializeApp } from "firebase/app";
import { getFirestore, doc, getDoc, setDoc, deleteDoc } from "firebase/firestore";

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
};
