import { MAX_BACKUP_BYTES, missingProfileMessage, profileLibrary, profileName, readProfile, serializeBackup } from '../store/library';
import type { NatalProfile, ProfileSettings } from '../store/library';
import { resolveBirthTime } from '../time/resolve';
import { downloadText } from './download';
import { node, houseName } from './readings';
import { byId } from './timeline';

const dateFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

/** The birth date as typed (YYYY-MM-DD), formatted without any time-zone shift. */
function birthDate(date: string) {
  const value = Date.parse(`${date}T00:00:00Z`);
  return Number.isNaN(value) ? date : dateFormat.format(new Date(value));
}

function coordinate(value: number, positive: string, negative: string) {
  return `${Math.abs(value).toFixed(2)}° ${value >= 0 ? positive : negative}`;
}

export function describeProfile(profile: NatalProfile) {
  const { birth, observer } = profile;
  return {
    date: birthDate(birth.date),
    time: birth.time ? `${birth.time} local` : 'Birth time unknown',
    place: birth.timeZone ?? (birth.offsetOverride ? `UTC${birth.offsetOverride}` : 'No time zone'),
    coordinates: observer ? `${coordinate(observer.latitudeDeg, 'N', 'S')}, ${coordinate(observer.longitudeDeg, 'E', 'W')}` : 'No coordinates',
    houses: houseName(profile.houseSystem),
  };
}

const initials = (name: string) => [...name.trim().split(/\s+/).slice(0, 2).map(word => [...word][0] ?? '')].join('').toUpperCase() || '·';

export interface ProfileController {
  save(name: string): Promise<{ profile: NatalProfile; message: string }>;
  load(id: string): Promise<{ ok: boolean; message: string }>;
  list(): readonly NatalProfile[];
  isAvailable(): boolean;
  syncActive(): void;
}

export function mountProfiles(
  deltaT: (year: number) => number,
  current: () => ProfileSettings | null,
  use: (profile: NatalProfile) => boolean,
  changed: (id: string, name: string | null, saved?: ProfileSettings) => void,
  signal: AbortSignal,
  options?: {
    activeId?: () => string | undefined;
    onSync?: (profiles: readonly NatalProfile[], available: boolean) => void;
  },
): ProfileController {
  const validate = (value: unknown) => readProfile(value, birth => resolveBirthTime(birth, deltaT).kind !== 'unresolved');
  const store = profileLibrary(validate);
  const controls = byId<HTMLFieldSetElement>('profile-controls');
  const names = byId<HTMLInputElement>('profile-name');
  const cards = byId('profile-cards');
  const empty = byId('profile-empty');
  const backup = byId<HTMLButtonElement>('profile-backup');
  const restore = byId<HTMLInputElement>('profile-restore');
  const dialog = byId<HTMLDialogElement>('backup-dialog');
  const opener = byId<HTMLButtonElement>('backup-open');
  const status = byId('profile-status');
  const backupStatus = byId('backup-status');
  let profiles: NatalProfile[] = [];
  let busy = false;
  let available = false;
  /** Card-level interaction state: which profile is being renamed or is awaiting delete confirmation. */
  let editing: { id: string; mode: 'rename' | 'delete'; draft?: string } | undefined;
  type Focus = () => HTMLElement | null | undefined;
  const cardButton = (id: string, action: string): Focus => () => [...cards.querySelectorAll<HTMLElement>('[data-profile-action]')]
    .find(element => element.dataset.profileId === id && element.dataset.profileAction === action)
    ?? cards.querySelector<HTMLElement>(`[data-profile-id="${id}"] [data-profile-action]`);
  const firstCard: Focus = () => cards.querySelector<HTMLElement>('[data-profile-action="load"]') ?? names;

  const say = (text: string) => { status.textContent = backupStatus.textContent = text; };

  function button(text: string, action: string, id: string, label: string, className = '') {
    const element = node('button', text);
    element.type = 'button';
    element.dataset.profileAction = action;
    element.dataset.profileId = id;
    // The accessible name starts with the visible text and adds the profile, so repeated buttons stay distinct.
    const name = profiles.find(profile => profile.id === id)?.name ?? '';
    element.setAttribute('aria-label', action === 'confirm-delete' ? text : `${label} ${name}`.trim());
    element.disabled = busy || !available;
    if (className) element.className = className;
    return element;
  }

  function card(profile: NatalProfile) {
    const info = describeProfile(profile);
    const item = node('li');
    item.className = 'profile-card';
    item.dataset.profileId = profile.id;
    const isActive = options?.activeId?.() === profile.id;
    if (isActive) item.dataset.active = 'true';
    const avatar = node('span', initials(profile.name));
    avatar.className = 'profile-avatar';
    avatar.setAttribute('aria-hidden', 'true');
    const head = node('div');
    head.className = 'profile-head';
    if (editing?.id === profile.id && editing.mode === 'rename') {
      const form = node('form');
      form.className = 'profile-rename';
      form.dataset.profileId = profile.id;
      const label = node('label', `New name for ${profile.name}`);
      const input = node('input');
      input.value = editing.draft ?? profile.name;
      input.maxLength = 80;
      input.autocomplete = 'off';
      input.dataset.renameInput = '';
      label.append(input);
      const save = node('button', 'Save name');
      save.type = 'submit';
      save.className = 'primary';
      const cancel = button('Cancel', 'cancel', profile.id, 'Cancel renaming');
      form.append(label, save, cancel);
      head.append(form);
    } else {
      const title = node('h3', profile.name);
      title.className = 'profile-name';
      head.append(title);
      if (isActive) {
        const badge = node('span', 'Loaded');
        badge.className = 'profile-loaded';
        head.append(badge);
      }
    }
    const facts = node('ul');
    facts.className = 'profile-facts';
    for (const text of [info.date, info.time, info.place, info.coordinates, `${info.houses} houses`]) facts.append(node('li', text));
    const actions = node('div');
    actions.className = 'profile-actions';
    if (editing?.id === profile.id && editing.mode === 'delete') {
      const ask = node('p', `Delete “${profile.name}” from this browser?`);
      ask.className = 'profile-confirm';
      ask.setAttribute('role', 'alert');
      actions.append(ask, button('Delete profile', 'confirm-delete', profile.id, 'Confirm deleting', 'danger'),
        button('Keep', 'cancel', profile.id, 'Keep'));
    } else {
      actions.append(button('Load', 'load', profile.id, 'Load', 'primary'), button('Rename', 'rename', profile.id, 'Rename'),
        button('Delete', 'delete', profile.id, 'Delete', 'quiet-danger'));
    }
    const text = node('div');
    text.className = 'profile-text';
    text.append(head, facts);
    item.append(avatar, text, actions);
    return item;
  }

  function render(focus?: Focus) {
    cards.replaceChildren(...profiles.map(card));
    empty.hidden = profiles.length > 0 || !available;
    controls.disabled = restore.disabled = backup.disabled = busy || !available;
    options?.onSync?.(profiles, available);
    focus?.()?.focus();
  }

  async function refresh() {
    const listed = await store.list();
    profiles = listed.profiles;
    if (editing && !profiles.some(profile => profile.id === editing!.id)) editing = undefined;
    return listed.skipped;
  }

  async function run(action: () => Promise<string>, after?: Focus) {
    if (busy) return;
    busy = true;
    say('');
    render();
    try { say(await action()); }
    catch (error) { say(error instanceof Error ? error.message : 'The library action failed.'); }
    finally { busy = false; render(after); }
  }

  const find = (id: string) => profiles.find(profile => profile.id === id);

  async function saveProfile(rawName: string) {
    if (!available) throw new Error('The local profile library is unavailable.');
    const settings = current();
    if (!settings) throw new Error('Calculate the edited birth details before saving.');
    const profile = { ...settings, name: profileName(rawName), id: crypto.randomUUID() };
    await store.add(profile);
    changed(profile.id, profile.name, settings);
    await refresh();
    render();
    return { profile, message: 'Profile saved locally.' };
  }

  byId('profile-save').addEventListener('click', () => void run(async () => {
    const { message } = await saveProfile(names.value);
    names.value = '';
    return message;
  }, () => byId('profile-save')), { signal });

  async function load(id: string) {
    // Another tab may have renamed or deleted it: consult the stored record, not the cached list.
    const profile = await store.get(id);
    if (!profile) {
      await refresh();
      return missingProfileMessage + ' The current chart was retained.';
    }
    if (!use(profile)) throw new Error('This profile could not be loaded. The current chart was retained.');
    await refresh();
    return 'Profile loaded.';
  }

  async function rename(id: string, value: string) {
    const name = profileName(value);
    try { await store.rename(id, name); }
    catch (error) {
      if (error instanceof Error && error.message === missingProfileMessage) {
        editing = undefined;
        await refresh();
        return missingProfileMessage;
      }
      throw error;
    }
    editing = undefined;
    changed(id, name);
    await refresh();
    return 'Profile renamed.';
  }

  cards.addEventListener('click', event => {
    const target = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-profile-action]');
    if (!target || busy || !available) return;
    const { profileId: id, profileAction: action } = target.dataset as { profileId: string; profileAction: string };
    if (action === 'load') void run(() => load(id), cardButton(id, 'load'));
    else if (action === 'rename') {
      editing = { id, mode: 'rename' };
      render(() => cards.querySelector<HTMLInputElement>('[data-rename-input]'));
      cards.querySelector<HTMLInputElement>('[data-rename-input]')?.select();
    } else if (action === 'delete') {
      editing = { id, mode: 'delete' };
      render(cardButton(id, 'cancel'));
    } else if (action === 'cancel') {
      const was = editing?.mode;
      editing = undefined;
      render(cardButton(id, was === 'delete' ? 'delete' : 'rename'));
    } else if (action === 'confirm-delete') {
      editing = undefined;
      void run(async () => {
        const existed = await store.remove(id);
        changed(id, null);
        await refresh();
        return existed ? 'Profile deleted.' : 'This profile was already deleted in another tab.';
      }, firstCard);
    }
  }, { signal });
  cards.addEventListener('submit', event => {
    event.preventDefault();
    const form = event.target as HTMLFormElement;
    const id = form.dataset.profileId!;
    const input = form.querySelector<HTMLInputElement>('input')!;
    if (busy) return;
    if (editing) editing.draft = input.value;
    void run(() => rename(id, input.value), () => cards.querySelector<HTMLInputElement>('[data-rename-input]') ?? cardButton(id, 'rename')());
  }, { signal });
  cards.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !editing) return;
    const id = editing.id;
    const was = editing.mode;
    editing = undefined;
    render(cardButton(id, was === 'delete' ? 'delete' : 'rename'));
  }, { signal });

  backup.addEventListener('click', () => void run(async () => {
    const current = await store.list();
    if (current.skipped) throw new Error('Backup stopped because the library contains invalid records.');
    downloadText('divine-orchestration-profiles.json', serializeBackup(current.profiles), 'application/json');
    return 'Profile backup downloaded. It contains personal birth details.';
  }, () => backup), { signal });
  restore.addEventListener('change', () => {
    const file = restore.files?.[0];
    restore.value = '';
    if (!file) return;
    void run(async () => {
      if (file.size > MAX_BACKUP_BYTES) throw new Error('Backup exceeds the 1 MB size limit.');
      const count = await store.restore(await file.text());
      await refresh();
      return `Restored ${count} ${count === 1 ? 'profile' : 'profiles'}.`;
    }, () => restore);
  }, { signal });

  opener.addEventListener('click', () => {
    backupStatus.textContent = '';
    if (!dialog.open) dialog.showModal();
    byId('backup-heading').focus();
  }, { signal });
  byId('backup-close').addEventListener('click', () => dialog.close(), { signal });
  dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); }, { signal });
  dialog.addEventListener('close', () => opener.focus(), { signal });

  void run(async () => {
    const skipped = await refresh();
    available = true;
    return skipped ? `${skipped} invalid profile records were skipped.` : 'Library ready.';
  });

  return {
    save: saveProfile,
    async load(id: string) {
      if (busy || !available) return { ok: false, message: 'The profile library is busy or unavailable.' };
      busy = true;
      say('');
      render();
      let message = '';
      let ok = false;
      try {
        message = await load(id);
        say(message);
        ok = message === 'Profile loaded.';
      } catch (error) {
        message = error instanceof Error ? error.message : 'The library action failed.';
        say(message);
      } finally {
        busy = false;
        render();
      }
      return { ok, message };
    },
    list: () => profiles,
    isAvailable: () => available,
    syncActive: () => render(),
  };
}
