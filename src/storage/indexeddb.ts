import type { Transfer } from './interface.js';
import type { RawActivity } from '../ingestion/client.js';

const DB_NAME = 'aptos-tracker';
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('transfers')) {
        const store = db.createObjectStore('transfers', { keyPath: 'id', autoIncrement: true });
        store.createIndex('sender', 'sender', { unique: false });
        store.createIndex('receiver', 'receiver', { unique: false });
        store.createIndex('timestamp', 'timestamp', { unique: false });
        store.createIndex('asset_type', 'asset_type', { unique: false });
        store.createIndex('dedup', ['transaction_version', 'sender', 'receiver', 'asset_type', 'amount'], { unique: true });
      }
      if (!db.objectStoreNames.contains('raw_activities')) {
        const store = db.createObjectStore('raw_activities', { keyPath: ['transaction_version', 'event_index'] });
        store.createIndex('owner_address', 'owner_address', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

export async function idbInsertTransfers(transfers: Transfer[]): Promise<void> {
  const db = await openDb();
  const tx = db.transaction('transfers', 'readwrite');
  const store = tx.objectStore('transfers');
  for (const t of transfers) {
    const req = store.add(t);
    // Absorb ConstraintError (dedup) without aborting the transaction
    req.onerror = (e) => {
      if ((req.error as DOMException)?.name === 'ConstraintError') {
        e.preventDefault();
        e.stopPropagation();
      }
    };
  }
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error);
  });
}

export async function idbInsertRawActivities(activities: RawActivity[]): Promise<void> {
  const db = await openDb();
  const tx = db.transaction('raw_activities', 'readwrite');
  const store = tx.objectStore('raw_activities');
  for (const a of activities) {
    const req = store.add(a);
    req.onerror = (e) => {
      if ((req.error as DOMException)?.name === 'ConstraintError') {
        e.preventDefault();
        e.stopPropagation();
      }
    };
  }
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error);
  });
}

export async function idbGetAllTransfers(): Promise<Transfer[]> {
  const db = await openDb();
  const tx = db.transaction('transfers', 'readonly');
  const store = tx.objectStore('transfers');
  return new Promise((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function idbGetTransfersByTimeRange(from?: string, to?: string): Promise<Transfer[]> {
  if (!from && !to) return idbGetAllTransfers();
  const db = await openDb();
  const tx = db.transaction('transfers', 'readonly');
  const store = tx.objectStore('transfers');
  const index = store.index('timestamp');
  const lower = from || '';
  const upper = to || '\uffff';
  const range = IDBKeyRange.bound(lower, upper);
  return new Promise((resolve, reject) => {
    const req = index.getAll(range);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function idbGetTransfersBySenderReceiver(sender: string, receiver: string, assetType?: string): Promise<Transfer[]> {
  const all = await idbGetAllTransfers();
  return all.filter(t =>
    t.sender === sender && t.receiver === receiver &&
    (!assetType || t.asset_type === assetType)
  );
}

export async function idbGetDistinctAssetTypes(): Promise<string[]> {
  const all = await idbGetAllTransfers();
  return [...new Set(all.map(t => t.asset_type))].sort();
}

export async function idbGetDistinctEntryFunctions(): Promise<{ entry_function: string; count: number }[]> {
  const all = await idbGetAllTransfers();
  const map = new Map<string, number>();
  for (const t of all) {
    if (t.entry_function) map.set(t.entry_function, (map.get(t.entry_function) || 0) + 1);
  }
  return [...map.entries()]
    .map(([entry_function, count]) => ({ entry_function, count }))
    .sort((a, b) => b.count - a.count);
}
