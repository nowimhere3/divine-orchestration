import type { Observer } from '../engine/ephemera';
import type { BirthTimeInput } from '../time/resolve';

export interface ProfileSettings {
  readonly birth: BirthTimeInput;
  readonly observer: Observer | null;
  readonly houseSystem: 'WholeSign' | 'Placidus';
}

export interface NatalProfile extends ProfileSettings {
  readonly id: string;
  readonly name: string;
}

const limit = 250;
const schema = 'divine-orchestration/profiles';
const storeName = 'profiles';
export const missingProfileMessage = 'This profile no longer exists in this browser. It may have been deleted in another tab.';
export const MAX_BACKUP_BYTES = 1_000_000;

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid profile data.');
  return value as Record<string, unknown>;
}

export function profileName(value: string) {
  const name = value.trim();
  if (!name || name.length > 80 || /[\u0000-\u001f]/.test(name)) throw new Error('Enter a profile name of 1–80 characters.');
  return name;
}

export function readProfile(value: unknown, validBirth: (birth: BirthTimeInput) => boolean): NatalProfile {
  const { id, name, birth, observer, houseSystem } = record(value);
  if (typeof id !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(id) || typeof name !== 'string' ||
      (houseSystem !== 'WholeSign' && houseSystem !== 'Placidus')) throw new Error('Invalid profile identity or house system.');
  const { date, time, timeZone, offsetOverride, disambiguation } = record(birth);
  if (typeof date !== 'string' || (time !== null && (typeof time !== 'string' || time.length > 13)) ||
      (timeZone !== undefined && (typeof timeZone !== 'string' || timeZone.length > 100)) ||
      (offsetOverride !== undefined && (typeof offsetOverride !== 'string' || offsetOverride.length > 9)) ||
      (disambiguation !== undefined && disambiguation !== 'earlier' && disambiguation !== 'later')) {
    throw new Error('Invalid birth details in profile.');
  }
  const input: BirthTimeInput = { date, time, ...(timeZone === undefined ? {} : { timeZone }),
    ...(offsetOverride === undefined ? {} : { offsetOverride }),
    ...(disambiguation === undefined ? {} : { disambiguation }) };
  if (!validBirth(input)) throw new Error('Profile birth details cannot be resolved. Check the date, time and offset.');
  let location: Observer | null = null;
  if (observer !== null) {
    const { latitudeDeg, longitudeDeg } = record(observer);
    if (typeof latitudeDeg !== 'number' || !Number.isFinite(latitudeDeg) || Math.abs(latitudeDeg) >= 90 ||
        typeof longitudeDeg !== 'number' || !Number.isFinite(longitudeDeg) || Math.abs(longitudeDeg) > 180) {
      throw new Error('Invalid coordinates in profile.');
    }
    location = { latitudeDeg, longitudeDeg };
  }
  return { id, name: profileName(name), birth: input, observer: location, houseSystem };
}

export function parseBackup(text: string, validate: (value: unknown) => NatalProfile) {
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error('Backup is not valid JSON.'); }
  const backup = record(value);
  if (backup.schema !== schema || backup.version !== 1) throw new Error('This profile backup format or version is unsupported.');
  if (!Array.isArray(backup.profiles) || backup.profiles.length > limit) throw new Error('Invalid profile list.');
  const profiles = backup.profiles.map(validate);
  if (new Set(profiles.map(profile => profile.id)).size !== profiles.length) throw new Error('Backup contains duplicate profile IDs.');
  return profiles;
}

export function serializeBackup(profiles: readonly NatalProfile[]) {
  return JSON.stringify({ schema, version: 1, profiles }, null, 2) + '\n';
}

async function openLibrary() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('divine-orchestration', 1);
    let blocked = false;
    request.onupgradeneeded = () => request.result.createObjectStore(storeName, { keyPath: 'id' });
    request.onblocked = () => { blocked = true; reject(new Error('Close other observatory tabs and try again.')); };
    request.onerror = () => reject(new Error('The local profile library is unavailable or uses a newer version.'));
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => database.close();
      if (blocked) database.close();
      else resolve(database);
    };
  });
}

async function transact<T>(mode: IDBTransactionMode, work: (
  store: IDBObjectStore, finish: (value: T) => void, fail: (error: unknown) => void,
) => void) {
  const database = await openLibrary();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(storeName, mode);
      let result: T;
      let failure: unknown;
      transaction.oncomplete = () => resolve(result);
      transaction.onabort = () => reject(failure ?? transaction.error ?? new Error('The profile transaction failed.'));
      const fail = (error: unknown) => { failure = error; transaction.abort(); };
      try { work(transaction.objectStore(storeName), value => { result = value; }, fail); }
      catch (error) { fail(error); }
    });
  } finally { database.close(); }
}

export function profileLibrary(validate: (value: unknown) => NatalProfile) {
  return {
    async list() {
      const rows = await transact<unknown[]>('readonly', (store, finish) => {
        const request = store.getAll();
        request.onsuccess = () => finish(request.result);
      });
      const profiles: NatalProfile[] = [];
      for (const row of rows) {
        try { profiles.push(validate(row)); } catch { /* Keep invalid records intact. */ }
      }
      return { profiles: profiles.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)),
        skipped: rows.length - profiles.length };
    },
    /** Reads the current stored record; null when it no longer exists. Throws when the record is invalid. */
    async get(id: string) {
      const row = await transact<unknown>('readonly', (store, finish) => {
        const request = store.get(id);
        request.onsuccess = () => finish(request.result);
      });
      return row === undefined ? null : validate(row);
    },
    add(profile: NatalProfile) {
      const clean = validate(profile);
      return transact<void>('readwrite', (store, finish, fail) => {
        const count = store.count();
        count.onsuccess = () => {
          if (count.result >= limit) { fail(new Error('The profile library is full.')); return; }
          store.add(clean);
          finish(undefined);
        };
      });
    },
    rename(id: string, name: string) {
      return transact<void>('readwrite', (store, finish, fail) => {
        const request = store.get(id);
        request.onsuccess = () => {
          if (request.result === undefined) { fail(new Error(missingProfileMessage)); return; }
          try { store.put(validate({ ...validate(request.result), name })); finish(undefined); }
          catch (error) { fail(error); }
        };
      });
    },
    /** Resolves true when a record was deleted, false when it was already gone. */
    remove(id: string) {
      return transact<boolean>('readwrite', (store, finish) => {
        const count = store.count(id);
        count.onsuccess = () => { store.delete(id); finish(count.result > 0); };
      });
    },
    restore(text: string) {
      const profiles = parseBackup(text, validate);
      return transact<number>('readwrite', (store, finish, fail) => {
        const existing = store.getAllKeys();
        existing.onsuccess = () => {
          const ids = new Set(existing.result);
          if (profiles.some(profile => ids.has(profile.id))) {
            fail(new Error('A backup profile already exists. No profiles were restored.')); return;
          }
          if (ids.size + profiles.length > limit) { fail(new Error('The backup exceeds the library capacity.')); return; }
          for (const profile of profiles) store.add(profile);
          finish(profiles.length);
        };
      });
    },
  };
}
