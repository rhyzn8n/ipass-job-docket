import { initializeApp } from "firebase/app";
import { getFirestore, doc, getDoc, setDoc, deleteDoc, collection, onSnapshot } from "firebase/firestore";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from "firebase/auth";
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage";

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
export const auth = getAuth(app);
const fbStorage = getStorage(app);

// Real file hosting — for anything too large to live inside a Firestore
// document (like a full-length song). Files are streamed, not text-encoded,
// so there's no 1MB document ceiling and playback doesn't load the whole
// file into memory at once the way a Firestore-stored data URL would.
export async function uploadAudioFile(memberId, file) {
  const path = `profile_audio/${memberId}`;
  const ref = storageRef(fbStorage, path);
  await uploadBytes(ref, file);
  return getDownloadURL(ref);
}
export async function deleteAudioFile(memberId) {
  try {
    await deleteObject(storageRef(fbStorage, `profile_audio/${memberId}`));
  } catch (e) {
    // Fine if it was already missing.
  }
}

// Chat images/GIFs go through Storage too, not Firestore — GIFs need their
// original bytes preserved to keep animating, and this keeps chat message
// documents small regardless of how many images get shared.
export async function uploadChatAttachment(messageId, file) {
  const ext = file.type === "image/gif" ? "gif" : "img";
  const path = `chat_attachments/${messageId}.${ext}`;
  const ref = storageRef(fbStorage, path);
  await uploadBytes(ref, file);
  return getDownloadURL(ref);
}
export async function deleteChatAttachment(url) {
  if (!url) return;
  try {
    await deleteObject(storageRef(fbStorage, url));
  } catch (e) {
    // Fine if it was already missing — deleteObject also accepts a gs:// path,
    // but callers here pass the stored download URL/path they uploaded with.
  }
}

// Real login gate: nobody reaches the app without a valid account.
// Firebase persists the session in the browser automatically, so people
// stay signed in across visits until they explicitly log out.
export function subscribeAuth(callback) {
  return onAuthStateChanged(auth, callback);
}
export async function loginWithEmail(email, password) {
  return signInWithEmailAndPassword(auth, email, password);
}
export async function logout() {
  return signOut(auth);
}

// Gives every user a stable id for "personal" (non-shared) data, e.g. which
// notifications they've already seen. Uses their real signed-in account id
// once logged in; falls back to a browser-local id only before that.
function getLocalUserId() {
  if (auth.currentUser?.uid) return auth.currentUser.uid;
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
