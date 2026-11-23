// On-screen controls for phones and tablets (M17 step 4): a direction pad on
// the left and confirm / cancel / menu buttons on the right, as an HTML layer
// over the game (crisp at any size). They hold actions through `HeldInputs`,
// like keys and gamepads. The rules are in `touch.ts`.
import type { Action } from '@freequest/core';
import type { HeldInputs } from './held-inputs.js';
import { padDirection } from './touch.js';

export interface TouchControls {
  /** Whether they're on screen. */
  readonly shown: boolean;
  show(): void;
  /** Remove the layer and its listeners. */
  dispose(): void;
}

const BUTTONS: readonly { action: Action; label: string; title: string; size: number }[] = [
  { action: 'confirm', label: 'A', title: 'Confirm', size: 68 },
  { action: 'cancel', label: 'B', title: 'Cancel', size: 56 },
  { action: 'menu', label: '☰', title: 'Menu', size: 44 },
];

/** Style shared by the pad and the buttons: see-through, untouched by page gestures. */
const CONTROL_STYLE: Partial<CSSStyleDeclaration> = {
  position: 'absolute',
  boxSizing: 'border-box',
  borderRadius: '50%',
  background: 'rgba(255, 255, 255, 0.14)',
  border: '2px solid rgba(255, 255, 255, 0.35)',
  color: 'rgba(255, 255, 255, 0.85)',
  display: 'grid',
  placeItems: 'center',
  font: 'bold 20px system-ui, -apple-system, sans-serif',
  touchAction: 'none',
  userSelect: 'none',
  pointerEvents: 'auto',
};

/** Keep a thumb's moves on the control it started on, even when it slides off. */
function capture(el: HTMLElement, e: PointerEvent): void {
  try {
    el.setPointerCapture(e.pointerId);
  } catch {
    // A pointer that's already gone: nothing to keep.
  }
}

export function createTouchControls(
  parent: HTMLElement,
  held: HeldInputs,
  options: {
    readonly shown: boolean;
    /** Called when the controls appear or disappear (the game refits around them). */
    readonly onChange: () => void;
    /** Called on every touch (sound can start after one). */
    readonly onTouch: () => void;
  },
): TouchControls {
  if (getComputedStyle(parent).position === 'static') parent.style.position = 'relative';
  const layer = document.createElement('div');
  layer.className = 'freequest-touch';
  Object.assign(layer.style, {
    position: 'absolute',
    inset: '0',
    pointerEvents: 'none',
    display: 'none',
    zIndex: '5',
    webkitUserSelect: 'none',
    webkitTouchCallout: 'none',
  } as Partial<CSSStyleDeclaration>);

  // The pad: a thumb anywhere on it points the way (the longer axis wins).
  const pad = document.createElement('div');
  pad.setAttribute('aria-label', 'Direction pad');
  const PAD = 132;
  Object.assign(pad.style, CONTROL_STYLE, {
    width: `${PAD}px`,
    height: `${PAD}px`,
    left: 'calc(18px + env(safe-area-inset-left, 0px))',
    bottom: 'calc(22px + env(safe-area-inset-bottom, 0px))',
  });
  const arrows = document.createElement('div');
  arrows.textContent = '▲\n◀  ▶\n▼';
  Object.assign(arrows.style, {
    whiteSpace: 'pre',
    textAlign: 'center',
    lineHeight: '1.15',
    fontSize: '16px',
    opacity: '0.7',
    pointerEvents: 'none',
  });
  pad.appendChild(arrows);
  let padPointer: number | null = null;
  const point = (e: PointerEvent) => {
    const r = pad.getBoundingClientRect();
    const direction = padDirection(
      e.clientX - (r.left + r.width / 2),
      e.clientY - (r.top + r.height / 2),
      r.width / 2,
    );
    if (direction) held.hold('touch:pad', direction);
    else held.letGo('touch:pad');
  };
  pad.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    options.onTouch();
    padPointer = e.pointerId;
    capture(pad, e);
    point(e);
  });
  pad.addEventListener('pointermove', (e) => {
    if (e.pointerId === padPointer) point(e);
  });
  const padUp = (e: PointerEvent) => {
    if (e.pointerId !== padPointer) return;
    padPointer = null;
    held.letGo('touch:pad');
  };
  pad.addEventListener('pointerup', padUp);
  pad.addEventListener('pointercancel', padUp);
  layer.appendChild(pad);

  // The buttons, in an arc at the bottom right: A biggest, nearest the thumb.
  const spots = [
    { right: 22, bottom: 40 },
    { right: 100, bottom: 18 },
    { right: 40, bottom: 120 },
  ];
  BUTTONS.forEach((b, i) => {
    const el = document.createElement('div');
    el.textContent = b.label;
    el.setAttribute('role', 'button');
    el.setAttribute('aria-label', b.title);
    const spot = spots[i] ?? { right: 22, bottom: 22 };
    Object.assign(el.style, CONTROL_STYLE, {
      width: `${b.size}px`,
      height: `${b.size}px`,
      right: `calc(${spot.right}px + env(safe-area-inset-right, 0px))`,
      bottom: `calc(${spot.bottom}px + env(safe-area-inset-bottom, 0px))`,
    });
    const id = `touch:${b.action}`;
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      options.onTouch();
      capture(el, e);
      el.style.background = 'rgba(255, 255, 255, 0.32)';
      held.hold(id, b.action);
    });
    const up = () => {
      el.style.background = CONTROL_STYLE.background ?? '';
      held.letGo(id);
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    layer.appendChild(el);
  });

  // Stop the page scrolling, zooming or selecting under a thumb.
  const blockGesture = (e: Event) => {
    if (e.target instanceof Node && layer.contains(e.target)) e.preventDefault();
  };
  layer.addEventListener('touchstart', blockGesture, { passive: false });
  layer.addEventListener('contextmenu', blockGesture);
  parent.appendChild(layer);

  let shown = false;
  const controls: TouchControls = {
    get shown() {
      return shown;
    },
    show() {
      if (shown) return;
      shown = true;
      layer.style.display = 'block';
      options.onChange();
    },
    dispose() {
      window.removeEventListener('touchstart', firstTouch);
      held.letGoAll('touch:');
      layer.remove();
    },
  };
  // A device that didn't look like a phone gets them on its first touch.
  const firstTouch = () => {
    options.onTouch();
    controls.show();
  };
  window.addEventListener('touchstart', firstTouch, { passive: true, once: true });
  if (options.shown) controls.show();
  return controls;
}
