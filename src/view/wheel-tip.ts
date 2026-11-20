/**
 * The hover, focus and tap label for chart symbols: "Saturn · Structure and responsibility".
 *
 * One tooltip element serves the whole wheel. It can be dismissed with Escape and stays until the pointer
 * or focus leaves the symbol. It ignores the pointer itself (see CSS), so it can never cover a neighbouring
 * glyph that is about to be clicked. It never carries information that is not also in the Inspector and in
 * the control's accessible description, so touch and keyboard users lose nothing when it is absent.
 */
export class WheelTip {
  private readonly element = document.createElement('div');
  private readonly main = document.createElement('span');
  private readonly kind = document.createElement('span');
  private owner: Element | null = null;
  private hideTimer = 0;
  private touchTimer = 0;
  private pressedAt = -Infinity;

  constructor(private readonly root: HTMLElement, signal: AbortSignal) {
    this.element.id = `${root.id}-tip`;
    this.element.className = 'wheel-tip';
    this.element.setAttribute('role', 'tooltip');
    // Assistive technology gets the same words from each control's accessible description, so this
    // purely visual label is hidden from it rather than announced twice.
    this.element.setAttribute('aria-hidden', 'true');
    this.element.hidden = true;
    this.main.className = 'tip-main';
    this.kind.className = 'tip-kind';
    this.element.append(this.main, this.kind);
    document.body.append(this.element);
    signal.addEventListener('abort', () => { this.clearTimers(); this.element.remove(); }, { once: true });

    root.addEventListener('pointerdown', () => { this.pressedAt = performance.now(); }, { signal, capture: true });
    const target = (event: Event) => (event.target instanceof Element ? event.target.closest<SVGElement>('[data-tip]') : null);
    root.addEventListener('pointerover', event => {
      // Touch has no hover; its label appears on tap (see `flash`).
      if ((event as PointerEvent).pointerType === 'touch') return;
      const node = target(event);
      if (node) this.show(node, event as PointerEvent);
    }, { signal });
    root.addEventListener('pointermove', event => {
      if ((event as PointerEvent).pointerType === 'touch' || !this.owner) return;
      if (target(event) === this.owner) this.place(event as PointerEvent);
    }, { signal });
    root.addEventListener('pointerout', event => {
      const node = target(event);
      const next = (event as PointerEvent).relatedTarget;
      if (node && node === this.owner && !(next instanceof Node && node.contains(next))) this.scheduleHide();
    }, { signal });
    root.addEventListener('focusin', event => {
      const node = target(event);
      // A press also focuses. Its label is already placed by the pointer (or by the tap), so only focus that did
      // not come from a press, such as Tab or an arrow key, shows one here.
      if (node && !this.pressedRecently()) this.show(node);
    }, { signal });
    root.addEventListener('focusout', event => {
      if (target(event) === this.owner) this.hide();
    }, { signal });
    document.addEventListener('keydown', event => { if (event.key === 'Escape' && !this.element.hidden) this.hide(); }, { signal });
  }

  /** True just after a mouse or finger press, when any focus change is a side effect of that press. */
  pressedRecently() { return performance.now() - this.pressedAt < 500; }

  /** Shows the label for a tapped element for a moment, since a finger cannot hover. */
  flash(node: Element, milliseconds = 2600) {
    const marked = node.closest<SVGElement>('[data-tip]');
    if (!marked) return;
    this.show(marked);
    window.clearTimeout(this.touchTimer);
    this.touchTimer = window.setTimeout(() => this.hide(), milliseconds);
  }

  show(node: Element, pointer?: PointerEvent) {
    this.clearTimers();
    this.owner = node;
    this.main.textContent = node.getAttribute('data-tip') ?? '';
    this.kind.textContent = node.getAttribute('data-tip-kind') ?? '';
    this.element.hidden = false;
    this.place(pointer);
  }

  hide() {
    this.clearTimers();
    this.owner = null;
    this.element.hidden = true;
  }

  /** True when the label belongs to an element that has since been replaced by a redraw. */
  dropIfStale() {
    if (this.owner && !this.owner.isConnected) this.hide();
  }

  private scheduleHide() {
    this.clearTimers(false);
    this.hideTimer = window.setTimeout(() => this.hide(), 140);
  }

  private clearTimers(touch = true) {
    window.clearTimeout(this.hideTimer);
    if (touch) window.clearTimeout(this.touchTimer);
  }

  private place(pointer?: PointerEvent) {
    if (!this.owner) return;
    const box = this.owner.getBoundingClientRect();
    const tip = this.element.getBoundingClientRect();
    const gap = 12;
    // Mouse: just below and right of the pointer. Keyboard focus or touch: centred under the element.
    let x = pointer ? pointer.clientX + gap : box.left + box.width / 2 - tip.width / 2;
    let y = pointer ? pointer.clientY + gap + 6 : box.bottom + gap;
    if (y + tip.height > window.innerHeight - 8) y = (pointer ? pointer.clientY : box.top) - tip.height - gap;
    x = Math.max(8, Math.min(x, window.innerWidth - tip.width - 8));
    y = Math.max(8, y);
    this.element.style.left = `${Math.round(x)}px`;
    this.element.style.top = `${Math.round(y)}px`;
  }
}
