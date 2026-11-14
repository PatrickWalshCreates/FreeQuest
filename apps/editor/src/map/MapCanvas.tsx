import type { Passability } from '@freequest/core';
import type { TileCell, Viewport } from '@freequest/editor-core';
import type { CharacterGraphic } from '@freequest/runtime';
import type { GameMap, Tileset } from '@freequest/schema';
import type { Texture } from 'pixi.js';
import { useEffect, useRef, useState } from 'react';
import { MapRenderer, type RenderOptions } from './map-renderer.js';

export interface CanvasPoint {
  /** Screen pixels relative to the canvas's top left. */
  readonly sx: number;
  readonly sy: number;
}

interface Props {
  readonly map: GameMap;
  readonly tileset: Tileset;
  readonly textures: readonly Texture[];
  readonly graphics: ReadonlyMap<string, CharacterGraphic>;
  readonly viewport: Viewport | null;
  readonly options: RenderOptions;
  readonly hover: { x: number; y: number } | null;
  readonly onResize: (width: number, height: number) => void;
  /** Wheel: plain scroll pans; with Ctrl (or a trackpad pinch) it zooms. */
  readonly onPan: (dx: number, dy: number) => void;
  /** Zoom by `steps` levels (positive zooms in) around a point. */
  readonly onZoom: (steps: number, at: CanvasPoint) => void;
  readonly onPointerMove: (at: CanvasPoint | null) => void;
  /** Left (or right/Alt for picking) button pressed for the current tool; moves arrive via onPointerMove. */
  readonly onToolDown: (at: CanvasPoint, how: { readonly pick: boolean }) => void;
  readonly onToolUp: () => void;
  readonly onToolCancel: () => void;
  readonly brush: readonly TileCell[];
  /** The selected event's cell, outlined. */
  /** The selected event's cell, or a selected area (Select tool). */
  readonly selection: {
    readonly x: number;
    readonly y: number;
    readonly width?: number;
    readonly height?: number;
  } | null;
  readonly walkability: Passability | null;
}

/** Pixels of pinch/Ctrl-wheel travel per zoom step. */
const ZOOM_STEP_DELTA = 60;

/** The PixiJS map canvas. Owns the renderer; turns wheel and drag gestures into callbacks. */
export function MapCanvas(props: Props) {
  const host = useRef<HTMLDivElement>(null);
  const [renderer, setRenderer] = useState<MapRenderer | null>(null);
  // Latest callbacks for listeners registered once.
  const latest = useRef(props);
  useEffect(() => {
    latest.current = props;
  });

  // Create the renderer once. StrictMode mounts twice, so a renderer that
  // finishes initialising after unmount is destroyed straight away.
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let alive = true;
    let created: MapRenderer | null = null;
    void MapRenderer.create(element).then((r) => {
      if (alive) {
        created = r;
        setRenderer(r);
        // Handy for inspecting the scene from the console during development.
        if (import.meta.env.DEV) (window as { mapRenderer?: MapRenderer }).mapRenderer = r;
      } else r.destroy();
    });
    return () => {
      alive = false;
      created?.destroy();
      setRenderer(null);
    };
  }, []);

  const { map, tileset, textures, graphics, viewport, options, hover, brush, walkability } = props;
  const selX = props.selection?.x;
  const selY = props.selection?.y;
  const selW = props.selection?.width ?? 1;
  const selH = props.selection?.height ?? 1;
  useEffect(() => renderer?.setMap(map, tileset, textures), [renderer, map, tileset, textures]);
  useEffect(() => renderer?.setEvents(map.events, graphics), [renderer, map.events, graphics]);
  useEffect(() => renderer?.setOptions(options), [renderer, options]);
  useEffect(() => {
    if (viewport) renderer?.setViewport(viewport);
  }, [renderer, viewport]);
  useEffect(() => renderer?.setHover(hover), [renderer, hover]);
  useEffect(() => renderer?.setBrush(brush), [renderer, brush]);
  useEffect(
    () =>
      renderer?.setSelection(
        selX === undefined || selY === undefined
          ? null
          : { x: selX, y: selY, width: selW, height: selH },
      ),
    [renderer, selX, selY, selW, selH],
  );
  useEffect(() => renderer?.setWalkability(walkability), [renderer, walkability]);

  // Size changes (the first one sets up the viewport).
  useEffect(() => {
    const element = host.current;
    if (!element || !renderer) return;
    const report = () => {
      renderer.app.resize();
      const { width, height } = renderer.viewSize;
      latest.current.onResize(width, height);
    };
    const observer = new ResizeObserver(report);
    observer.observe(element);
    report();
    return () => observer.disconnect();
  }, [renderer]);

  // Wheel needs a non-passive listener to stop the page from scrolling.
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let pinch = 0;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1;
      if (event.ctrlKey || event.metaKey) {
        pinch += event.deltaY * scale;
        const rect = element.getBoundingClientRect();
        const at = { sx: event.clientX - rect.left, sy: event.clientY - rect.top };
        const steps = Math.trunc(pinch / ZOOM_STEP_DELTA);
        if (steps !== 0) {
          pinch -= steps * ZOOM_STEP_DELTA;
          latest.current.onZoom(-steps, at);
        }
      } else {
        latest.current.onPan(event.deltaX * scale, event.deltaY * scale);
      }
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, []);

  // Space held = hand tool, like most drawing programs.
  const [spaceHeld, setSpaceHeld] = useState(false);
  useEffect(() => {
    const typing = (event: KeyboardEvent) =>
      event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement;
    const down = (event: KeyboardEvent) => {
      if (event.code === 'Space' && !typing(event)) {
        event.preventDefault();
        setSpaceHeld(true);
      }
    };
    const up = (event: KeyboardEvent) => {
      if (event.code === 'Space') setSpaceHeld(false);
    };
    const blur = () => setSpaceHeld(false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, []);

  /** The pointer currently pressed: panning, or a tool gesture forwarded to the editor. */
  const press = useRef<{ id: number; mode: 'pan' | 'tool'; x: number; y: number } | null>(null);
  const point = (event: React.PointerEvent): CanvasPoint => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { sx: event.clientX - rect.left, sy: event.clientY - rect.top };
  };
  const [panning, setPanning] = useState(false);

  return (
    <div
      ref={host}
      className={['map-canvas', spaceHeld || panning ? 'hand' : '', panning ? 'panning' : '']
        .filter(Boolean)
        .join(' ')}
      onContextMenu={(event) => event.preventDefault()}
      onPointerDown={(event) => {
        if (press.current) return;
        event.currentTarget.focus();
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
          // Synthetic or already-released pointers can't be captured; the press still works.
        }
        const pan = event.button === 1 || (event.button === 0 && spaceHeld);
        press.current = {
          id: event.pointerId,
          mode: pan ? 'pan' : 'tool',
          x: event.clientX,
          y: event.clientY,
        };
        if (pan) setPanning(true);
        else
          props.onToolDown(point(event), {
            pick: event.button === 2 || event.altKey,
          });
      }}
      onPointerMove={(event) => {
        const p = press.current;
        if (p?.id === event.pointerId && p.mode === 'pan') {
          props.onPan(p.x - event.clientX, p.y - event.clientY);
          press.current = { ...p, x: event.clientX, y: event.clientY };
        }
        props.onPointerMove(point(event));
      }}
      onPointerUp={(event) => {
        const p = press.current;
        if (p?.id !== event.pointerId) return;
        press.current = null;
        if (p.mode === 'pan') setPanning(false);
        else props.onToolUp();
      }}
      onPointerCancel={() => {
        if (press.current?.mode === 'tool') props.onToolCancel();
        press.current = null;
        setPanning(false);
      }}
      onPointerLeave={() => {
        if (!press.current) props.onPointerMove(null);
      }}
      tabIndex={0}
      aria-label="Map canvas"
    />
  );
}
