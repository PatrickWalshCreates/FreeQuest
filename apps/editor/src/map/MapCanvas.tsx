import type { Viewport } from '@freequest/editor-core';
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
      } else r.destroy();
    });
    return () => {
      alive = false;
      created?.destroy();
      setRenderer(null);
    };
  }, []);

  const { map, tileset, textures, graphics, viewport, options, hover } = props;
  useEffect(() => renderer?.setMap(map, tileset, textures), [renderer, map, tileset, textures]);
  useEffect(() => renderer?.setEvents(map.events, graphics), [renderer, map.events, graphics]);
  useEffect(() => renderer?.setOptions(options), [renderer, options]);
  useEffect(() => {
    if (viewport) renderer?.setViewport(viewport);
  }, [renderer, viewport]);
  useEffect(() => renderer?.setHover(hover), [renderer, hover]);

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

  // Drag to pan (any button for now; step 4 gives the left button to the tools).
  const drag = useRef<{ id: number; x: number; y: number } | null>(null);
  const point = (event: React.PointerEvent): CanvasPoint => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { sx: event.clientX - rect.left, sy: event.clientY - rect.top };
  };

  return (
    <div
      ref={host}
      className="map-canvas"
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
      }}
      onPointerMove={(event) => {
        const d = drag.current;
        if (d?.id === event.pointerId) {
          props.onPan(d.x - event.clientX, d.y - event.clientY);
          drag.current = { id: d.id, x: event.clientX, y: event.clientY };
        }
        props.onPointerMove(point(event));
      }}
      onPointerUp={(event) => {
        if (drag.current?.id === event.pointerId) drag.current = null;
      }}
      onPointerCancel={() => (drag.current = null)}
      onPointerLeave={() => props.onPointerMove(null)}
    />
  );
}
