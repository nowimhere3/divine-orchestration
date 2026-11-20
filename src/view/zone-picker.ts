import { describeZoneSelection, isValidIanaZone, searchTimeZones } from '../time/zones';
import type { TimeZoneEntry } from '../time/zones';
import { node } from './readings';
import { byId } from './timeline';

export function mountZonePicker(
  deltaT: (fractionalYear: number) => number,
  readDateTime: () => { date: string; time: string | null },
  signal: AbortSignal,
) {
  const input = byId<HTMLInputElement>('birth-zone');
  const toggle = byId<HTMLButtonElement>('birth-zone-toggle');
  const list = byId<HTMLUListElement>('birth-zone-list');
  const summary = byId('birth-zone-summary');
  const alberta = byId<HTMLButtonElement>('birth-alberta');
  const picker = input.closest('.zone-picker')!;

  let open = false;
  let choosing = false;
  let items: readonly TimeZoneEntry[] = [];
  let activeIndex = -1;

  function syncSummary() {
    const { date, time } = readDateTime();
    const info = describeZoneSelection(input.value, date, time, deltaT);
    summary.replaceChildren();
    const title = node('strong', info.title);
    const sep = document.createTextNode(' — ');
    const detail = node('span', info.detail);
    summary.append(title, sep, detail);
    summary.dataset.valid = String(info.valid);
    if (!input.value.trim() || info.valid) input.removeAttribute('aria-invalid');
    else input.setAttribute('aria-invalid', 'true');
  }

  function setExpanded(next: boolean) {
    open = next;
    list.hidden = !next;
    input.setAttribute('aria-expanded', String(next));
    toggle.setAttribute('aria-expanded', String(next));
    if (!next) {
      activeIndex = -1;
      input.removeAttribute('aria-activedescendant');
    }
  }

  function highlight(index: number) {
    activeIndex = index;
    const options = [...list.querySelectorAll<HTMLLIElement>('[role="option"]')];
    for (const [i, option] of options.entries()) {
      const selected = i === index;
      option.setAttribute('aria-selected', String(selected));
      if (selected) {
        input.setAttribute('aria-activedescendant', option.id);
        option.scrollIntoView({ block: 'nearest' });
      }
    }
    if (index < 0) input.removeAttribute('aria-activedescendant');
  }

  function renderList(query: string) {
    const trimmed = query.trim();
    const matches = searchTimeZones(trimmed, 18);
    const listItems = [...matches];
    if (trimmed && isValidIanaZone(trimmed) && !listItems.some(entry => entry.id.toLowerCase() === trimmed.toLowerCase())) {
      listItems.unshift({
        id: trimmed,
        label: `Manual IANA zone · ${trimmed}`,
        region: 'Custom',
        keywords: [],
      });
    }
    items = listItems;
    list.replaceChildren();
    if (!items.length) {
      const empty = node('li', 'No matching city or IANA zone. Enter a valid IANA identifier such as America/Edmonton.');
      empty.className = 'zone-empty';
      list.append(empty);
      activeIndex = -1;
      input.removeAttribute('aria-activedescendant');
      return;
    }

    const current = input.value.trim().toLowerCase();
    let initialActive = -1;
    for (const [index, entry] of items.entries()) {
      const option = document.createElement('li');
      option.id = `birth-zone-opt-${index}`;
      option.role = 'option';
      option.className = 'zone-option';
      option.dataset.zoneId = entry.id;
      const isCurrent = entry.id.toLowerCase() === current;
      option.setAttribute('aria-selected', String(isCurrent));
      if (isCurrent && initialActive < 0) initialActive = index;

      const name = node('span', entry.label);
      name.className = 'zone-option-label';
      const meta = node('span', `${entry.id} · ${entry.region}`);
      meta.className = 'zone-option-meta';
      option.append(name, meta);
      list.append(option);
    }
    highlight(trimmed ? 0 : initialActive);
  }

  function openList(showAll = false) {
    renderList(showAll ? '' : input.value);
    setExpanded(true);
  }

  function choose(zoneId: string) {
    input.value = zoneId;
    setExpanded(false);
    syncSummary();
    choosing = true;
    try { input.dispatchEvent(new Event('input', { bubbles: true })); }
    finally { choosing = false; }
  }

  input.addEventListener('focus', () => {
    // Show featured choices when opening with an already-selected zone, or filter if user is typing.
    if (!open) openList(isValidIanaZone(input.value));
  }, { signal });

  input.addEventListener('input', () => {
    syncSummary();
    if (document.activeElement === input && !choosing) openList(false);
  }, { signal });

  input.addEventListener('keydown', event => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!open) {
        openList(isValidIanaZone(input.value));
        return;
      }
      if (items.length) highlight((activeIndex + 1) % items.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) {
        openList(isValidIanaZone(input.value));
        return;
      }
      if (items.length) highlight(activeIndex <= 0 ? items.length - 1 : activeIndex - 1);
    } else if (event.key === 'Enter' && open && activeIndex >= 0 && items[activeIndex]) {
      event.preventDefault();
      choose(items[activeIndex].id);
    } else if (event.key === 'Escape' && open) {
      event.preventDefault();
      event.stopPropagation();
      setExpanded(false);
    }
  }, { signal });

  toggle.addEventListener('click', () => {
    if (open) {
      setExpanded(false);
    } else {
      input.focus();
      openList(true);
    }
  }, { signal });

  list.addEventListener('pointerdown', event => {
    const option = (event.target as HTMLElement).closest<HTMLLIElement>('[data-zone-id]');
    if (!option) return;
    event.preventDefault();
    choose(option.dataset.zoneId!);
  }, { signal });

  alberta.addEventListener('click', () => {
    choose('America/Edmonton');
  }, { signal });

  document.addEventListener('pointerdown', event => {
    if (open && !picker.contains(event.target as Node)) setExpanded(false);
  }, { signal });

  input.addEventListener('blur', () => {
    // Close on Tab/focus exit without breaking pointerdown on options (handled via preventDefault).
    requestAnimationFrame(() => {
      if (open && !picker.contains(document.activeElement)) setExpanded(false);
    });
  }, { signal });

  syncSummary();
  return {
    sync: syncSummary,
    close: () => setExpanded(false),
  };
}
