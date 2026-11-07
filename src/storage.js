const DB_NAME = "fauxdos-6502";
const STORE = "disks";
const KEY = "drive-c";

function openDatabase() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) { reject(new Error("IndexedDB unavailable")); return; }
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Unable to open disk storage"));
  });
}

export async function loadStoredDisk() {
  try {
    const db = await openDatabase();
    const value = await new Promise((resolve, reject) => {
      const request = db.transaction(STORE, "readonly").objectStore(STORE).get(KEY);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
    db.close();
    if (value) return new Uint8Array(value);
  } catch { /* Use bundled image / localStorage fallback below. */ }
  try {
    const stored = localStorage.getItem("fauxdos-drive-c");
    if (stored) return Uint8Array.from(atob(stored), c => c.charCodeAt(0));
  } catch { /* Storage can be disabled in private browsing. */ }
  return null;
}

export async function saveStoredDisk(bytes) {
  const copy = bytes.slice();
  try {
    const db = await openDatabase();
    await new Promise((resolve, reject) => {
      const request = db.transaction(STORE, "readwrite").objectStore(STORE).put(copy, KEY);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
    db.close();
    return true;
  } catch {
    try {
      let binary = "";
      for (let i = 0; i < copy.length; i += 0x2000) {
        binary += String.fromCharCode(...copy.subarray(i, Math.min(i + 0x2000, copy.length)));
      }
      localStorage.setItem("fauxdos-drive-c", btoa(binary));
      return true;
    } catch {
      return false;
    }
  }
}
