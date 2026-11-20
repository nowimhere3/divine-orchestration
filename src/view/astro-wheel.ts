import { Chart as AstroChart } from '@astrodraw/astrochart';
import type { AspectFact } from '../domain/aspects';
import type { Chart, HouseFacts, PlanetId, PlanetRef } from '../domain/chart';
import { angleEntry, aspectEntry, bodyEntry, houseEntry, parseElementKey, signEntry, tipText } from '../knowledge';
import type { Entry } from '../knowledge';
import { orderedCusps, planetName, titleCase } from './chart-data';
import type { PositionMap } from './chart-data';
import { WheelTip } from './wheel-tip';

type Radix = ReturnType<AstroChart['radix']>;
type Transit = ReturnType<Radix['transit']>;
type AstroData = Parameters<AstroChart['radix']>[0];
type LibraryAspect = NonNullable<Parameters<Radix['aspects']>[0]>[number];

const SVG = 'http://www.w3.org/2000/svg';
const neutralSectors = Array.from({ length: 12 }, (_, index) => index * 30);
// Teal for supportive contacts, rose for tense ones, lilac for blending. Line style also
// differs (see observatory.css) so the meaning never depends on color alone.
const colors: Record<AspectFact['aspect'], string> = {
  conjunction: '#d6c4ff', sextile: '#7fd6c2', trine: '#7fd6c2', square: '#f08ba0', opposition: '#f08ba0',
};
// Fire, earth, air and water, repeated from Aries. Deep, low-chroma tints keep glyphs legible.
const elementTints = ['#3b2335', '#1f3335', '#2c2a4d', '#1f2c4b'];
const signTints = Array.from({ length: 12 }, (_, sign) => elementTints[sign % 4]);
/** Space around the 640-unit wheel so outer transit glyphs and their targets never clip. */
const VIEW_PADDING = 24;
const FULL = 640 + 2 * VIEW_PADDING;
export const MAX_ZOOM = 4;
const ZOOM_STEP = 1.5;
/** A touch or mouse drag shorter than this many pixels is still a click. */
const DRAG_THRESHOLD = 6;
let chartNumber = 0;

export const pointKey = ({ chartId, planetId }: PlanetRef) => `${chartId}/${planetId}`;

function wheelData(positions: PositionMap, cusps: readonly number[]): AstroData {
  if (!orderedCusps(cusps)) throw new Error('Invalid wheel cusps.');
  const planets: AstroData['planets'] = {};
  for (const [id, { longitudeDeg, longitudeSpeedDegPerDay }] of positions) {
    if (longitudeDeg < 0 || longitudeDeg >= 360 || !Number.isFinite(longitudeDeg) || !Number.isFinite(longitudeSpeedDegPerDay)) {
      throw new Error('Invalid wheel position.');
    }
    planets[planetName(id)] = [longitudeDeg, longitudeSpeedDegPerDay];
  }
  return { planets, cusps: [...cusps] };
}

/** The only module that touches AstroChart or its generated SVG. */
export class AstroWheel {
  private readonly mount = document.createElement('div');
  private readonly listeners = new AbortController();
  private chart?: AstroChart;
  private natal?: Chart;
  private overlay?: Transit;
  private highlight?: SVGGElement;
  private radix?: Radix;
  private pressed = '';
  private selection = '';
  /** The visible square of the wheel, in SVG units. The full view is FULL wide and starts at -VIEW_PADDING. */
  private view = { x: -VIEW_PADDING, y: -VIEW_PADDING, w: FULL };
  private viewListener?: (zoom: number) => void;
  private suppressClickUntil = 0;
  private lastPointer = 'mouse';
  private members: readonly string[] = [];
  private readonly tip: WheelTip;

  constructor(private readonly host: HTMLElement, onSelectPlanet: (key: string) => void) {
    do {
      this.mount.id = `orchestration-wheel-${++chartNumber}`;
    } while (document.getElementById(this.mount.id));
    this.host.append(this.mount);
    const select = (event: Event) => {
      // Planets and the Ascendant/Midheaven marks sit above the sign and house regions, so the nearest match wins.
      const control = event.target instanceof Element ? event.target.closest('[data-point-key], [data-element-key]') : null;
      const key = control?.getAttribute('data-point-key') ?? control?.getAttribute('data-element-key');
      if (!key || !control || !this.mount.contains(control)) return;
      event.preventDefault();
      onSelectPlanet(key);
      if (this.lastPointer === 'touch') this.tip.flash(control);
    };
    const { signal } = this.listeners;
    this.tip = new WheelTip(this.mount, signal);
    this.mount.addEventListener('pointerdown', event => { this.lastPointer = event.pointerType; }, { signal, capture: true });
    this.mount.addEventListener('click', event => {
      // A drag or pinch that ends over a glyph must not also select it.
      if (performance.now() < this.suppressClickUntil) { event.preventDefault(); return; }
      select(event);
    }, { signal });
    this.mount.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') { select(event); return; }
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (this.rove(event)) return;
      const pan = this.view.w * .18;
      const moves: Record<string, () => void> = {
        '+': () => this.zoomBy(ZOOM_STEP), '=': () => this.zoomBy(ZOOM_STEP), '-': () => this.zoomBy(1 / ZOOM_STEP), _: () => this.zoomBy(1 / ZOOM_STEP),
        '0': () => this.resetView(),
        ArrowLeft: () => this.panBy(-pan, 0), ArrowRight: () => this.panBy(pan, 0),
        ArrowUp: () => this.panBy(0, -pan), ArrowDown: () => this.panBy(0, pan),
      };
      if (!(event.key in moves) || (event.key.startsWith('Arrow') && this.zoom <= 1)) return;
      event.preventDefault();
      moves[event.key]();
    }, { signal });
    // Keyboard focus on a glyph outside the zoomed view brings it into view.
    this.mount.addEventListener('focusin', event => {
      if (!(event.target instanceof Element)) return;
      const element = event.target.closest<SVGGraphicsElement>('[data-element-key]');
      if (element?.hasAttribute('data-rove')) this.setRoving(element);
      // Only keyboard focus pans the view. A press that focuses a half-hidden glyph must not move the wheel
      // out from under the pointer, or the click that follows would miss its target.
      if (this.zoom <= 1 || this.tip.pressedRecently()) return;
      const circle = event.target.closest('[data-point-key]')?.querySelector('circle');
      if (circle) { this.reveal(Number(circle.getAttribute('cx')), Number(circle.getAttribute('cy'))); return; }
      if (element) {
        const box = element.getBBox();
        this.reveal(box.x + box.width / 2, box.y + box.height / 2);
      }
    }, { signal });
    this.mount.addEventListener('wheel', event => {
      // Ctrl or ⌘ with the wheel (and a trackpad pinch) zooms; plain scrolling still scrolls the page.
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      this.zoomBy(Math.exp(-event.deltaY * .01), this.toSvg(event.clientX, event.clientY));
    }, { signal, passive: false });
    this.bindPointers(signal);
  }

  /** The current magnification, from 1 (whole wheel) to MAX_ZOOM. */
  get zoom() { return FULL / this.view.w; }

  /** The SVG position of a planet's glyph, so zoom controls can keep a selection in view. */
  pointOf(key: string): readonly [number, number] | undefined {
    const circle = [...this.mount.querySelectorAll('[data-point-key]')].find(node => node.getAttribute('data-point-key') === key)?.querySelector('circle');
    return circle ? [Number(circle.getAttribute('cx')), Number(circle.getAttribute('cy'))] : undefined;
  }

  /** Called after every zoom or pan so the controls can update. */
  onViewChange(listener: (zoom: number) => void) { this.viewListener = listener; }

  zoomBy(factor: number, around?: readonly [number, number]) {
    const next = Math.min(MAX_ZOOM, Math.max(1, this.zoom * factor));
    const width = FULL / next;
    const [px, py] = around ?? [this.view.x + this.view.w / 2, this.view.y + this.view.w / 2];
    const ratio = width / this.view.w;
    this.setView(px - (px - this.view.x) * ratio, py - (py - this.view.y) * ratio, width);
  }

  panBy(dx: number, dy: number) { this.setView(this.view.x + dx, this.view.y + dy, this.view.w); }

  resetView() { this.setView(-VIEW_PADDING, -VIEW_PADDING, FULL); }

  /** Pans the least amount that puts a point (with room for its glyph) inside the visible square. */
  private reveal(x: number, y: number) {
    const margin = Math.min(48, this.view.w / 4);
    const shift = (point: number, origin: number) => point - margin < origin ? point - margin - origin
      : point + margin > origin + this.view.w ? point + margin - origin - this.view.w : 0;
    const dx = shift(x, this.view.x);
    const dy = shift(y, this.view.y);
    if (dx || dy) this.panBy(dx, dy);
  }

  private setView(x: number, y: number, w: number) {
    const size = Math.min(FULL, Math.max(FULL / MAX_ZOOM, w));
    const clamp = (value: number) => Math.min(-VIEW_PADDING + FULL - size, Math.max(-VIEW_PADDING, value));
    this.view = { x: clamp(x), y: clamp(y), w: size };
    this.applyView();
  }

  private applyView() {
    const frame = this.chart?.paper.DOMElement;
    const { x, y, w } = this.view;
    frame?.setAttribute('viewBox', `${x} ${y} ${w} ${w}`);
    if (this.zoom > 1.001) this.host.setAttribute('data-zoomed', '');
    else this.host.removeAttribute('data-zoomed');
    this.viewListener?.(this.zoom);
  }

  /** Client pixels to SVG units under the current view. */
  private toSvg(clientX: number, clientY: number) {
    const rect = (this.chart?.paper.DOMElement ?? this.mount).getBoundingClientRect();
    return [this.view.x + (clientX - rect.left) / rect.width * this.view.w,
      this.view.y + (clientY - rect.top) / rect.height * this.view.w] as const;
  }

  /** One pointer drags a zoomed wheel; two pointers pinch and pan it. */
  private bindPointers(signal: AbortSignal) {
    const pointers = new Map<number, { x: number; y: number }>();
    let pinch: { distance: number; zoom: number } | undefined;
    let dragged = false;
    let origin = { x: 0, y: 0 };
    const midpoint = () => {
      const [a, b] = [...pointers.values()];
      return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, distance: Math.hypot(a.x - b.x, a.y - b.y) };
    };
    this.mount.addEventListener('pointerdown', event => {
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointers.size === 1) { dragged = false; origin = { x: event.clientX, y: event.clientY }; }
      if (pointers.size === 2) { pinch = { distance: midpoint().distance || 1, zoom: this.zoom }; dragged = true; }
    }, { signal });
    this.mount.addEventListener('pointermove', event => {
      const last = pointers.get(event.pointerId);
      if (!last) return;
      const current = { x: event.clientX, y: event.clientY };
      if (pointers.size === 2 && pinch) {
        const before = midpoint();
        pointers.set(event.pointerId, current);
        const after = midpoint();
        const rect = (this.chart?.paper.DOMElement ?? this.mount).getBoundingClientRect();
        // Zoom about the fingers' midpoint, then follow the midpoint as it moves.
        this.zoomBy(pinch.zoom * after.distance / pinch.distance / this.zoom, this.toSvg(before.x, before.y));
        this.panBy(-(after.x - before.x) * this.view.w / rect.width, -(after.y - before.y) * this.view.w / rect.height);
        return;
      }
      pointers.set(event.pointerId, current);
      if (pointers.size !== 1 || this.zoom <= 1.001) return;
      if (!dragged && Math.hypot(current.x - origin.x, current.y - origin.y) < DRAG_THRESHOLD) return;
      if (!dragged) {
        dragged = true;
        // Capture keeps the drag alive outside the wheel; a pointer that has already gone is not an error.
        try { this.mount.setPointerCapture?.(event.pointerId); } catch { /* ignore */ }
      }
      const rect = (this.chart?.paper.DOMElement ?? this.mount).getBoundingClientRect();
      this.panBy(-(current.x - last.x) * this.view.w / rect.width, -(current.y - last.y) * this.view.w / rect.height);
    }, { signal });
    const end = (event: PointerEvent) => {
      if (!pointers.delete(event.pointerId)) return;
      if (dragged) this.suppressClickUntil = performance.now() + 350;
      if (pointers.size < 2) pinch = undefined;
      if (pointers.size === 0) dragged = false;
    };
    this.mount.addEventListener('pointerup', end, { signal });
    this.mount.addEventListener('pointercancel', end, { signal });
    this.mount.addEventListener('lostpointercapture', end, { signal });
  }

  render(natal: Chart, positions: PositionMap, transits: PositionMap, aspects: readonly AspectFact[]) {
    const active = this.mount.contains(document.activeElement) ? document.activeElement?.getAttribute('data-point-key') : null;
    if (this.natal !== natal || !this.overlay) {
      this.mount.replaceChildren();
      if (document.getElementById(this.mount.id) !== this.mount) throw new Error('Wheel mount is unavailable.');
      // No settings argument. AstroChart otherwise merges it into a module-wide singleton.
      const chart = new AstroChart(this.mount.id, 640, 640);
      const settings = {
        ...structuredClone(chart.settings),
        SYMBOL_SCALE: 1.3, COLLISION_RADIUS: 19, MARGIN: 74, PADDING: 9,
        COLOR_BACKGROUND: '#141123', POINTS_COLOR: '#dccdff', SIGNS_COLOR: '#e6dcf6',
        CIRCLE_COLOR: '#6a5c8c', LINE_COLOR: '#6a5c8c', CIRCLE_STRONG: 1,
        CUSPS_FONT_COLOR: '#cdbfe6', CUSPS_STROKE: 1, SYMBOL_AXIS_FONT_COLOR: '#f2c47e',
        COLORS_SIGNS: signTints,
        SHOW_DIGNITIES_TEXT: false, ADD_CLICK_AREA: false,
      };
      chart.settings = settings;
      chart.paper.settings = settings;
      const frame = chart.paper.DOMElement;
      frame.setAttribute('viewBox', `${-VIEW_PADDING} ${-VIEW_PADDING} ${640 + 2 * VIEW_PADDING} ${640 + 2 * VIEW_PADDING}`);
      frame.setAttribute('style', 'position: relative; overflow: visible;');
      chart.paper.DOMElement.setAttribute('role', 'group');
      chart.paper.DOMElement.setAttribute('aria-label', 'Interactive natal and transit wheel');
      this.chart = chart;
      this.applyView();
      const houses = natal.houses.status === 'available' ? natal.houses.value : null;
      const radix = chart.radix(wheelData(positions, houses?.cusps.map(cusp => cusp.longitudeDeg) ?? neutralSectors));
      this.radix = radix;
      this.preparePoints(radix, 'natal', positions);
      radix.aspects(aspects.map(aspect => this.toLibraryAspect(aspect, positions)));
      chart.paper.root.querySelector(`[id$="-${settings.ID_ASPECTS}"]`)?.classList.add('wheel-aspects');
      const overlay = radix.transit(wheelData(transits, neutralSectors));
      this.overlay = overlay;
      this.drawTrack(radix, 'natal');
      this.drawTrack(overlay, 'transit');

      // AstroChart needs twelve sectors even to draw a house-less view. Its
      // built-in angle labels are cusp-based, which is wrong for Whole Sign.
      for (const suffix of [settings.ID_AXIS, ...(houses ? [] : [settings.ID_CUSPS])]) {
        radix.universe.querySelector(`[id$="-${suffix}"]`)?.remove();
      }
      overlay.universe.querySelector(`[id$="-${settings.ID_CUSPS}"]`)?.remove();
      this.buildRegions(houses);
      if (houses) {
        this.angleMark('ASC', 'asc', houses.ascendantDeg);
        this.angleMark('MC', 'mc', houses.midheavenDeg);
      }
      this.highlight = document.createElementNS(SVG, 'g');
      this.highlight.classList.add('wheel-highlight');
      this.highlight.setAttribute('aria-hidden', 'true');
      chart.paper.root.append(this.highlight);
      this.buildAspectTargets(aspects, positions);
      this.natal = natal;
    } else {
      this.overlay.data = wheelData(transits, neutralSectors);
      this.overlay.drawPoints();
    }
    this.preparePoints(this.overlay, 'transit', transits);
    this.updatePressed(this.pressed, undefined, [], this.members);
    this.tip.dropIfStale();
    if (active) {
      [...this.mount.querySelectorAll<SVGElement>('[data-point-key]')]
        .find(node => node.dataset.pointKey === active)?.focus({ preventScroll: true });
    }
  }

  /**
   * Marks the selection. A planet shows every aspect it forms (`related`) and dims the rest.
   * An aspect shows only itself. Both draw in the highlight layer above the base lines.
   */
  select(key: string, aspect: AspectFact | undefined, positions: PositionMap, transits: PositionMap,
    related: readonly AspectFact[] = [], members: readonly string[] = []) {
    const shown = aspect ? [aspect] : key ? related : [];
    this.members = members;
    this.updatePressed(key, aspect, aspect ? [] : related, members);
    const element = parseElementKey(key);
    // A planet or an aspect type dims the rest; a sign, house or angle only marks what lies inside it.
    this.host.dataset.selection = aspect ? 'aspect' : !key || element?.type === 'concept' ? ''
      : !element ? 'planet' : element.type === 'aspect' ? 'aspect-type' : 'region';
    if (members.length) this.host.dataset.members = String(members.length);
    else delete this.host.dataset.members;
    this.highlight?.replaceChildren();
    if (!this.radix || !this.highlight) return;
    const signature = `${key}|${aspect?.id ?? ''}`;
    // Fade lines in only when the selection changes, not on every Time Machine redraw.
    this.highlight.toggleAttribute('data-fresh', signature !== this.selection);
    this.selection = signature;
    const longitude = (point: PlanetRef) => (point.chartId === 'natal' ? positions : transits).get(point.planetId)?.longitudeDeg;
    const radius = this.radix.radius / this.radix.settings.INDOOR_CIRCLE_RADIUS_RATIO;
    for (const fact of shown) {
      const from = longitude(fact.from);
      const to = longitude(fact.to);
      if (from === undefined || to === undefined) continue;
      const line = this.line(from, to, radius, radius, colors[fact.aspect]);
      line.setAttribute('data-name', fact.aspect);
      line.classList.add(aspect ? 'wheel-focus' : 'wheel-related');
      this.highlight.append(line);
    }
  }

  clear() {
    this.mount.replaceChildren();
    this.host.removeAttribute('data-zoomed');
    this.chart = undefined;
    this.natal = undefined;
    this.radix = undefined;
    this.overlay = undefined;
    this.highlight = undefined;
    this.tip.hide();
  }

  dispose() {
    this.listeners.abort();
    this.clear();
    this.mount.remove();
  }

  private updatePressed(key: string, aspect?: AspectFact, related: readonly AspectFact[] = [], members: readonly string[] = []) {
    this.pressed = key;
    const endpoints = aspect ? [pointKey(aspect.from), pointKey(aspect.to)] : [];
    const partners = new Set([...related.flatMap(fact => [pointKey(fact.from), pointKey(fact.to)]), ...members]);
    partners.delete(key);
    for (const node of this.mount.querySelectorAll('[data-element-key]')) {
      node.setAttribute('aria-pressed', String(node.getAttribute('data-element-key') === key));
    }
    for (const node of this.mount.querySelectorAll('[data-point-key]')) {
      const point = node.getAttribute('data-point-key')!;
      node.setAttribute('aria-pressed', String(point === key));
      node.toggleAttribute('data-aspect-member', endpoints.includes(point));
      node.toggleAttribute('data-related', partners.has(point));
    }
  }

  /** A faint dotted ring behind a layer's glyphs: lilac for natal, gold for transit. */
  private drawTrack(ring: Radix | Transit, layer: 'natal' | 'transit') {
    const points = ring.locatedPoints;
    const wrapper = ring.universe.querySelector(`[id$="-${ring.settings.ID_POINTS}"]`);
    if (!points.length || !wrapper) return;
    const radius = points.reduce((sum, point) => sum + Math.hypot(point.x - ring.cx, point.y - ring.cy), 0) / points.length;
    const track = this.chart!.paper.circle(ring.cx, ring.cy, radius);
    track.setAttribute('fill', 'none');
    track.classList.add('wheel-track', `wheel-track-${layer}`);
    track.setAttribute('aria-hidden', 'true');
    ring.universe.insertBefore(track, wrapper);
  }

  private preparePoints(ring: Radix | Transit, layer: 'natal' | 'transit', positions: PositionMap) {
    const wrapper = ring.universe.querySelector(`[id$="-${ring.settings.ID_POINTS}"]`);
    if (!wrapper) return;
    // Transit emits dignity text even with SHOW_DIGNITIES_TEXT disabled.
    for (const node of wrapper.querySelectorAll('text')) node.remove();
    const allowed = new Map<string, PlanetId>([...positions.keys()].map(id => [planetName(id), id]));
    for (const point of ring.locatedPoints) {
      const id = allowed.get(point.name);
      if (!id) continue;
      const symbol = document.getElementById(`${wrapper.id}-${point.name}`);
      if (!symbol || symbol.parentNode !== wrapper) continue;
      const button = document.createElementNS(SVG, 'g');
      const target = document.createElementNS(SVG, 'circle');
      button.setAttribute('role', 'button');
      button.setAttribute('tabindex', '0');
      button.setAttribute('aria-label', `${layer === 'natal' ? 'Natal' : 'Transit'} ${point.name}`);
      button.setAttribute('aria-controls', 'inspection');
      button.setAttribute('data-point-key', pointKey({ chartId: layer, planetId: id }));
      button.setAttribute('data-layer', layer);
      this.markTip(button, bodyEntry(id), `${titleCase(layer)} planet`);
      target.classList.add('planet-target');
      target.setAttribute('cx', String(point.x));
      target.setAttribute('cy', String(point.y));
      target.setAttribute('r', '19');
      wrapper.insertBefore(button, symbol);
      symbol.setAttribute('aria-hidden', 'true');
      if (layer === 'transit') {
        for (const stroke of symbol.querySelectorAll('[stroke]')) stroke.setAttribute('stroke', '#f5c888');
        for (const fill of symbol.querySelectorAll('[fill]:not([fill="none"])')) fill.setAttribute('fill', '#f5c888');
      }
      button.append(target, symbol);
    }
  }

  private toLibraryAspect(fact: AspectFact, positions: PositionMap): LibraryAspect {
    const point = (ref: PlanetRef) => ({ name: planetName(ref.planetId), position: positions.get(ref.planetId)!.longitudeDeg });
    return { point: point(fact.from), toPoint: point(fact.to),
      aspect: { name: fact.aspect, degree: fact.exactAngleDeg, color: colors[fact.aspect], orbit: fact.allowedOrbDeg },
      precision: String(fact.orbDeg) };
  }

  private coordinates(longitude: number, radius: number) {
    const { cx, cy, shift, settings } = this.radix!;
    const radians = (settings.SHIFT_IN_DEGREES - longitude - shift) * Math.PI / 180;
    return [cx + radius * Math.cos(radians), cy + radius * Math.sin(radians)] as const;
  }

  private line(from: number, to: number, firstRadius: number, secondRadius: number, color: string) {
    const [x1, y1] = this.coordinates(from, firstRadius);
    const [x2, y2] = this.coordinates(to, secondRadius);
    const line = this.chart!.paper.line(x1, y1, x2, y2);
    line.setAttribute('stroke', color);
    return line;
  }

  private angleMark(label: string, which: 'asc' | 'mc', longitude: number) {
    const radius = this.radix!.radius;
    const line = this.line(longitude, longitude, radius - 19, radius - 2, '#f5c888');
    line.classList.add('wheel-angle-mark');
    const [x, y] = this.coordinates(longitude, radius - 7);
    const text = this.chart!.paper.text(label, x, y, '11', '#f5c888');
    text.setAttribute('text-anchor', 'middle');
    text.classList.add('wheel-angle');
    const target = document.createElementNS(SVG, 'circle');
    target.classList.add('planet-target');
    target.setAttribute('cx', String(x));
    target.setAttribute('cy', String(y));
    target.setAttribute('r', '17');
    const group = document.createElementNS(SVG, 'g');
    group.classList.add('wheel-angle-button');
    // The name starts with the visible text (ASC, MC) so voice control and screen readers agree with what is drawn.
    this.makeButton(group, `angle/${which}`, which === 'asc' ? 'ASC, Ascendant' : 'MC, Midheaven');
    this.markTip(group, angleEntry(which), 'Chart angle');
    group.setAttribute('tabindex', '0');
    group.append(target, line, text);
    this.chart!.paper.root.append(group);
  }

  /** Makes an SVG element a selectable control that the Inspector describes. */
  private makeButton(node: Element, key: string, label: string) {
    node.setAttribute('role', 'button');
    node.setAttribute('aria-label', label);
    node.setAttribute('aria-controls', 'inspection');
    node.setAttribute('aria-pressed', 'false');
    node.setAttribute('data-element-key', key);
  }

  /** Records the hover label (and an accessible description) on a control. */
  private markTip(node: Element, entry: Entry | undefined, kind: string, extra = '') {
    if (!entry) return;
    const text = tipText(entry);
    node.setAttribute('data-tip', text);
    node.setAttribute('data-tip-kind', extra ? `${kind} · ${extra}` : kind);
    node.setAttribute('aria-description', text);
  }

  /** A point on the circle for a longitude and radius, as a path fragment. */
  private point(longitude: number, radius: number) {
    const [x, y] = this.coordinates(longitude, radius);
    return `${x.toFixed(3)} ${y.toFixed(3)}`;
  }

  /** An annular sector from one longitude to the next, drawn counter-clockwise as longitude increases. */
  private sector(from: number, to: number, inner: number, outer: number) {
    const span = (((to - from) % 360) + 360) % 360 || 360;
    const large = span > 180 ? 1 : 0;
    return `M ${this.point(from, outer)} A ${outer} ${outer} 0 ${large} 0 ${this.point(from + span, outer)} `
      + `L ${this.point(from + span, inner)} A ${inner} ${inner} 0 ${large} 1 ${this.point(from, inner)} Z`;
  }

  /**
   * Invisible but real hit areas for the twelve signs and (when the chart has them) the twelve houses.
   * They sit beneath the planet glyphs and ignore the decorative rings, so a click on a planet, an angle
   * mark or an aspect line still reaches that element, and a drag still pans.
   */
  private buildRegions(houses: HouseFacts | null) {
    const radix = this.radix!;
    const outer = radix.radius;
    const signInner = outer - outer / radix.settings.INNER_CIRCLE_RADIUS_RATIO;
    const houseInner = outer / radix.settings.INDOOR_CIRCLE_RADIUS_RATIO;
    const layer = document.createElementNS(SVG, 'g');
    layer.classList.add('wheel-regions');
    const group = (label: string, name: string) => {
      const node = document.createElementNS(SVG, 'g');
      node.setAttribute('role', 'group');
      node.setAttribute('aria-label', label);
      node.setAttribute('data-rove-group', name);
      return node;
    };
    const region = (path: string, key: string, label: string, entry: Entry | undefined, kind: string, extra: string, first: boolean) => {
      const node = document.createElementNS(SVG, 'path');
      node.setAttribute('d', path);
      node.classList.add('wheel-hit');
      this.makeButton(node, key, label);
      this.markTip(node, entry, kind, extra);
      node.setAttribute('data-rove', '');
      node.setAttribute('tabindex', first ? '0' : '-1');
      return node;
    };
    const signs = group('Zodiac signs', 'signs');
    for (let index = 0; index < 12; index += 1) {
      const entry = signEntry(index);
      signs.append(region(this.sector(index * 30, index * 30 + 30, signInner, outer), `sign/${index}`,
        `Zodiac sign ${entry?.name}`, entry, 'Zodiac sign', `${index * 30}°–${index * 30 + 30}°`, index === 0));
    }
    layer.append(signs);
    if (houses) {
      const cusps = houses.cusps.map(cusp => cusp.longitudeDeg);
      const wheelHouses = group('Houses', 'houses');
      for (let index = 0; index < 12; index += 1) {
        wheelHouses.append(region(this.sector(cusps[index], cusps[(index + 1) % 12], houseInner, signInner), `house/${index + 1}`,
          `House ${index + 1}`, houseEntry(index + 1), 'House',
          houses.effectiveSystem === 'WholeSign' ? 'Whole Sign' : houses.effectiveSystem, index === 0));
      }
      layer.append(wheelHouses);
    }
    // Directly after the sign ring (which holds the glyphs) and before the planets, so planets win overlaps.
    radix.universe.querySelector(`[id$="-${radix.settings.ID_SIGNS}"]`)?.after(layer);
  }

  /** Wide invisible strokes over the natal aspect lines, so a line can be tapped or focused. */
  private buildAspectTargets(aspects: readonly AspectFact[], positions: PositionMap) {
    if (!this.radix || !aspects.length) return;
    const radius = this.radix.radius / this.radix.settings.INDOOR_CIRCLE_RADIUS_RATIO;
    const layer = document.createElementNS(SVG, 'g');
    layer.classList.add('wheel-aspect-targets');
    layer.setAttribute('role', 'group');
    layer.setAttribute('aria-label', 'Natal aspect lines');
    layer.setAttribute('data-rove-group', 'aspects');
    let first = true;
    for (const fact of aspects) {
      if (fact.from.chartId !== 'natal' || fact.to.chartId !== 'natal') continue;
      const from = positions.get(fact.from.planetId)?.longitudeDeg;
      const to = positions.get(fact.to.planetId)?.longitudeDeg;
      if (from === undefined || to === undefined) continue;
      const line = this.line(from, to, radius, radius, 'transparent');
      line.classList.add('wheel-hit', 'wheel-hit-line');
      this.makeButton(line, fact.id, `${titleCase(fact.aspect)}: ${planetName(fact.from.planetId)} to ${planetName(fact.to.planetId)}`);
      this.markTip(line, aspectEntry(fact.aspect), 'Natal aspect', `${planetName(fact.from.planetId)} – ${planetName(fact.to.planetId)}`);
      line.setAttribute('data-rove', '');
      line.setAttribute('tabindex', first ? '0' : '-1');
      first = false;
      layer.append(line);
    }
    if (layer.childElementCount) this.chart!.paper.root.append(layer);
  }

  /** Arrow keys, Home and End move between the siblings of a sign, house or aspect group. */
  private rove(event: KeyboardEvent) {
    const current = event.target instanceof Element ? event.target.closest<SVGElement>('[data-rove]') : null;
    if (!current) return false;
    const siblings = [...(current.parentElement?.querySelectorAll<SVGElement>('[data-rove]') ?? [])];
    const at = siblings.indexOf(current);
    const step = ({ ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 } as Record<string, number>)[event.key];
    let next = -1;
    if (step) next = (at + step + siblings.length) % siblings.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = siblings.length - 1;
    if (next < 0) return false;
    event.preventDefault();
    this.setRoving(siblings[next]);
    siblings[next].focus({ preventScroll: true });
    return true;
  }

  private setRoving(active: Element) {
    for (const sibling of active.parentElement?.querySelectorAll('[data-rove]') ?? []) {
      sibling.setAttribute('tabindex', sibling === active ? '0' : '-1');
    }
  }
}
