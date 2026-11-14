import { CollisionMap } from '@freequest/core';
import {
  type ProjectDocument,
  type ProjectFile,
  type TileCell,
  TileStroke,
  type Stamp,
  areaOnMap,
  clearArea,
  copyArea,
  placeStamp,
  tileStamp,
  type TileTool,
  type Viewport,
  type ViewportBounds,
  ZOOM_LEVELS,
  clampViewport,
  fitViewport,
  panBy,
  screenToTile,
  addEvent,
  clipboard,
  editMap,
  eventAt,
  inBounds,
  moveEvent,
  removeEvent,
  screenToWorld,
  stepZoom,
  tileAt,
  zoomAt,
} from '@freequest/editor-core';
import { EMPTY_TILE, type GameMap } from '@freequest/schema';
import { useMemo, useRef, useState } from 'react';
import { type CanvasPoint, MapCanvas } from './MapCanvas.js';
import { EventPanel, pasteEventAt } from '../events/EventPanel.js';
import { MapSettings } from './MapSettings.js';
import { type PaletteBlock, TilePalette, describeTile } from './TilePalette.js';
import { identityKey, loadCharacter, loadTileTextures, useLoaded } from './graphics.js';
import type { RenderOptions } from './map-renderer.js';
import { MOD } from '../keys.js';

interface Props {
  readonly doc: ProjectDocument;
  readonly file: ProjectFile<'map'> & { readonly data: GameMap };
  /** Playtest with the player starting on this map at a cell. */
  readonly onPlayFrom: (x: number, y: number) => void;
}

const PALETTE_WIDTH = 256;

/** The painting tools, the area tool (select, copy and cut blocks of the map) and the event tool. */
type EditorTool = TileTool | 'select' | 'event';

const TOOLS: readonly { id: EditorTool; label: string; key: string; hint: string }[] = [
  { id: 'pencil', label: 'Pencil', key: 'b', hint: 'Paint tiles by clicking or dragging' },
  { id: 'rectangle', label: 'Rectangle', key: 'r', hint: 'Drag to fill a rectangle' },
  { id: 'fill', label: 'Fill', key: 'f', hint: 'Fill the connected area of the same tile' },
  { id: 'eraser', label: 'Eraser', key: 'e', hint: 'Clear tiles on this layer' },
  { id: 'eyedropper', label: 'Pick', key: 'i', hint: 'Pick a tile from the map (or right-click)' },
  {
    id: 'select',
    label: 'Select',
    key: 'm',
    hint: `Drag out an area, then ${MOD}C copies it as the brush (Shift: this layer only), ${MOD}X cuts it, Delete clears it`,
  },
  {
    id: 'event',
    label: 'Events',
    key: 'v',
    hint: 'Select, drag and double-click to add events',
  },
];

/** Two clicks on the same cell within this many ms add an event. */
const DOUBLE_CLICK_MS = 400;

/** Tools that paint the palette's tile, so the brush shows it under the pointer. */
const PAINTS = new Set<EditorTool>(['pencil', 'rectangle', 'fill']);

/** The map editor: canvas, view controls, layers and the tile palette. */
export function MapEditor({ doc, file, onPlayFrom }: Props) {
  const map = file.data;
  const tilesetFile = doc.project.tilesets.get(map.tileset);
  const tileset = tilesetFile?.data ?? null;

  const textures = useLoaded(tileset, () =>
    tileset ? loadTileTextures(doc, tileset) : Promise.reject(new Error('no tileset')),
  );
  const imageUrl = useLoaded(tileset?.image, () =>
    tileset ? doc.fs.assetUrl(tileset.image) : Promise.reject(new Error('no tileset')),
  );
  // The view's Map is rebuilt on every edit; reload only when a sheet itself changes.
  const sheets = [...doc.project.characters.values()].flatMap((c) => (c.data ? [c.data] : []));
  const graphics = useLoaded(identityKey(sheets), async () => {
    const loaded = await Promise.all(sheets.map((sheet) => loadCharacter(doc, sheet)));
    return new Map(loaded.map((g) => [g.sheet.id, g]));
  });

  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [viewport, setViewport] = useState<Viewport | null>(null);
  const [activeLayer, setActiveLayer] = useState(0);
  const [hiddenLayers, setHiddenLayers] = useState<ReadonlySet<number>>(new Set());
  const [highlightActive, setHighlightActive] = useState(false);
  const [showGrid, setShowGrid] = useState(true);
  const [showEvents, setShowEvents] = useState(true);
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  /** What the painting tools paint: a tile, a block from the palette or a copied area. */
  const [brushStamp, setBrushStamp] = useState<Stamp>(() => tileStamp(0));
  /** Where the brush came from in the palette (null for a copied area). */
  const [paletteBlock, setPaletteBlock] = useState<PaletteBlock | null>({
    a: { x: 0, y: 0 },
    b: { x: 0, y: 0 },
  });
  /** The Select tool's area (corners), and its drag in progress. */
  const [area, setArea] = useState<{
    a: { x: number; y: number };
    b: { x: number; y: number };
  } | null>(null);
  const areaDrag = useRef(false);
  const [tool, setTool] = useState<EditorTool>('pencil');
  const [selectedEvent, setSelectedEvent] = useState<string | null>(null);
  /** The event being dragged, with the coalesce key that makes the drag one undo step. */
  const eventDrag = useRef<{ readonly id: string; readonly key: string } | null>(null);
  const lastClick = useRef<{
    readonly time: number;
    readonly x: number;
    readonly y: number;
  } | null>(null);
  const [showWalkable, setShowWalkable] = useState(false);
  const stroke = useRef<TileStroke | null>(null);
  const [preview, setPreview] = useState<readonly TileCell[] | null>(null);
  /** "Play from here": the next click on the map picks where the player starts. */
  const [pickingStart, setPickingStart] = useState(false);

  const options: RenderOptions = useMemo(
    () => ({ hiddenLayers, activeLayer, highlightActive, showGrid, showEvents }),
    [hiddenLayers, activeLayer, highlightActive, showGrid, showEvents],
  );
  // Exactly what the game uses for collision (tiles only; blocking events aren't included).
  const walkability = useMemo(() => {
    if (!showWalkable || !tileset) return null;
    try {
      return CollisionMap.fromMap(map, tileset);
    } catch {
      return null; // a tile missing from the tileset; the problems panel reports it
    }
  }, [showWalkable, map, tileset]);

  if (!tileset) {
    return <p className="error">This map's tileset "{map.tileset}" isn't available.</p>;
  }
  if (textures.status === 'error') {
    return <p className="error">Could not load the tileset image: {textures.message}</p>;
  }

  const bounds = (view = size): ViewportBounds | null =>
    view && {
      mapWidth: map.width * tileset.tileWidth,
      mapHeight: map.height * tileset.tileHeight,
      viewWidth: view.width,
      viewHeight: view.height,
    };
  const update = (change: (view: Viewport, b: ViewportBounds) => Viewport) => {
    const b = bounds();
    if (b) setViewport((view) => view && change(view, b));
  };
  const zoomTo = (zoom: number, at?: CanvasPoint) =>
    update((view, b) =>
      zoomAt(view, zoom, at?.sx ?? b.viewWidth / 2, at?.sy ?? b.viewHeight / 2, b),
    );
  const fit = () => {
    const b = bounds();
    if (b) setViewport(fitViewport(b));
  };
  const toggleLayer = (index: number) =>
    setHiddenLayers((hidden) => {
      const next = new Set(hidden);
      if (!next.delete(index)) next.add(index);
      return next;
    });

  /** The cell under a canvas point, even outside the map (strokes clip it themselves). */
  const cellAt = (at: CanvasPoint) => {
    if (!viewport) return null;
    const world = screenToWorld(viewport, at.sx, at.sy);
    return {
      x: Math.floor(world.x / tileset.tileWidth),
      y: Math.floor(world.y / tileset.tileHeight),
    };
  };
  const pick = (cell: { x: number; y: number }) => {
    const picked = new TileStroke(
      { doc, path: file.path, layer: activeLayer, tool: 'eyedropper', stamp: brushStamp },
      cell,
    ).picked;
    if (picked !== null && picked !== EMPTY_TILE && tileset) {
      setBrushStamp(tileStamp(picked));
      const at = { x: picked % tileset.columns, y: Math.floor(picked / tileset.columns) };
      setPaletteBlock({ a: at, b: at });
    }
  };
  const toolDown = (at: CanvasPoint, how: { readonly pick: boolean }) => {
    const cell = cellAt(at);
    if (!cell) return;
    if (pickingStart) {
      if (cell.x >= 0 && cell.y >= 0 && cell.x < map.width && cell.y < map.height) {
        setPickingStart(false);
        onPlayFrom(cell.x, cell.y);
      }
      return;
    }
    if (tool === 'event') {
      eventDown(cell);
      return;
    }
    if (tool === 'select') {
      areaDrag.current = true;
      setArea({ a: cell, b: cell });
      return;
    }
    if (how.pick || tool === 'eyedropper') {
      pick(cell);
      if (tool === 'eyedropper') setTool('pencil');
      return;
    }
    stroke.current = new TileStroke(
      { doc, path: file.path, layer: activeLayer, tool: tool as TileTool, stamp: brushStamp },
      cell,
    );
    setPreview(stroke.current.preview);
  };
  const eventDown = (cell: { x: number; y: number }) => {
    const now = performance.now();
    const last = lastClick.current;
    lastClick.current = { time: now, ...cell };
    const hit = eventAt(map, cell.x, cell.y);
    if (hit) {
      setSelectedEvent(hit.id);
      eventDrag.current = { id: hit.id, key: `move-event:${hit.id}:${now}` };
      return;
    }
    if (!inBounds(map, cell.x, cell.y)) return;
    const double =
      last && now - last.time < DOUBLE_CLICK_MS && last.x === cell.x && last.y === cell.y;
    if (double) {
      let added: string | null = null;
      editMap(doc, file.path, 'Add event', (m) => {
        const result = addEvent(m, cell.x, cell.y);
        added = result.id;
        return result.map;
      });
      setSelectedEvent(added);
      lastClick.current = null;
    } else setSelectedEvent(null);
  };
  const eventMove = (cell: { x: number; y: number }) => {
    const drag = eventDrag.current;
    if (!drag || !inBounds(map, cell.x, cell.y)) return;
    editMap(doc, file.path, 'Move event', (m) => moveEvent(m, drag.id, cell.x, cell.y), {
      coalesce: drag.key,
    });
  };
  const toolUp = () => {
    areaDrag.current = false;
    if (eventDrag.current) {
      eventDrag.current = null;
      doc.endCoalescing();
    }
    stroke.current?.finish();
    stroke.current = null;
    setPreview(null);
  };
  const cancelStroke = () => {
    stroke.current?.cancel();
    stroke.current = null;
    setPreview(null);
  };
  const chooseTool = (next: EditorTool) => {
    if (stroke.current) return;
    setTool(next);
  };

  // `preview` is non-null exactly while a stroke is in progress.
  const brush: readonly TileCell[] = pickingStart
    ? []
    : preview && preview.length > 0
      ? preview
      : hover && !preview && PAINTS.has(tool)
        ? placeStamp(brushStamp, map, hover, activeLayer).flatMap((edit) => edit.cells)
        : hover && tool === 'eraser'
          ? [{ ...hover, tile: EMPTY_TILE }]
          : [];

  const hoveredTile = hover ? tileAt(map, activeLayer, hover.x, hover.y) : EMPTY_TILE;
  const eventsHere = hover ? map.events.filter((e) => e.x === hover.x && e.y === hover.y) : [];
  const zoom = viewport?.zoom ?? 1;

  return (
    <div
      className="map-editor"
      tabIndex={-1}
      onKeyDown={(event) => {
        const target = event.target;
        const typing =
          target instanceof HTMLInputElement ||
          target instanceof HTMLTextAreaElement ||
          target instanceof HTMLSelectElement;
        if (typing) return;
        const key = event.key.toLowerCase();
        const onCanvas = target instanceof HTMLElement && target.classList.contains('map-canvas');
        if ((event.metaKey || event.ctrlKey) && tool === 'select') {
          // Copy (or cut) the selected area as the brush; Shift: the active layer only.
          if (event.altKey || !area || (key !== 'c' && key !== 'x')) return;
          const layer = event.shiftKey ? activeLayer : undefined;
          const copied = copyArea(map, area.a, area.b, layer);
          if (!copied) return;
          if (key === 'x') {
            editMap(doc, file.path, 'Cut area', (m) => clearArea(m, area.a, area.b, layer));
          }
          setBrushStamp(copied);
          setPaletteBlock(null);
          setTool('pencil');
          event.preventDefault();
          return;
        }
        if (event.metaKey || event.ctrlKey) {
          // Copy, cut and paste events on the map (Events tool); paste lands where the pointer is.
          if (!onCanvas || tool !== 'event' || event.altKey || event.shiftKey) return;
          const chosen = map.events.find((e) => e.id === selectedEvent);
          if ((key === 'c' || key === 'x') && chosen) {
            clipboard.set({ kind: 'event', event: chosen });
            if (key === 'x') {
              editMap(doc, file.path, 'Cut event', (m) => removeEvent(m, chosen.id));
              setSelectedEvent(null);
            }
          } else if (key === 'v') {
            const at = hover ??
              chosen ?? { x: Math.floor(map.width / 2), y: Math.floor(map.height / 2) };
            const id = pasteEventAt(doc, file.path, at.x, at.y);
            if (id) setSelectedEvent(id);
          } else return;
          event.preventDefault();
          return;
        }
        const shortcut = TOOLS.find((t) => t.key === key);
        if ((key === 'delete' || key === 'backspace') && tool === 'select' && area) {
          editMap(doc, file.path, 'Clear area', (m) => clearArea(m, area.a, area.b));
          event.preventDefault();
          return;
        }
        if (key === 'escape' && tool === 'select' && area) setArea(null);
        else if (key === 'escape' && pickingStart) setPickingStart(false);
        else if (key === 'escape' && stroke.current) cancelStroke();
        else if (shortcut) chooseTool(shortcut.id);
        else if (
          (key === 'delete' || key === 'backspace') &&
          onCanvas &&
          tool === 'event' &&
          selectedEvent
        ) {
          const id = selectedEvent;
          editMap(doc, file.path, 'Delete event', (m) => removeEvent(m, id));
          setSelectedEvent(null);
        } else if (key === '=' || key === '+') zoomTo(stepZoom(zoom, 1));
        else if (key === '-') zoomTo(stepZoom(zoom, -1));
        else if (key === '0') fit();
        else if (key === 'g') setShowGrid((v) => !v);
        else if (key === 'w') setShowWalkable((v) => !v);
        else return;
        event.preventDefault();
      }}
    >
      <div className="map-main">
        <div className="map-toolbar" role="toolbar" aria-label="Map tools">
          <div className="segmented" role="radiogroup" aria-label="Tool">
            {TOOLS.map((t) => (
              <button
                key={t.id}
                role="radio"
                aria-checked={tool === t.id}
                className={tool === t.id ? 'on' : undefined}
                title={`${t.hint} (${t.key.toUpperCase()})`}
                onClick={() => chooseTool(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
          <span className="divider" />
          <button onClick={() => zoomTo(stepZoom(zoom, -1))} title="Zoom out (-)">
            −
          </button>
          <select
            aria-label="Zoom"
            value={ZOOM_LEVELS.includes(zoom as never) ? zoom : ''}
            onChange={(event) => zoomTo(Number(event.target.value))}
          >
            {!ZOOM_LEVELS.includes(zoom as never) && (
              <option value="">{Math.round(zoom * 100)}%</option>
            )}
            {ZOOM_LEVELS.map((z) => (
              <option key={z} value={z}>
                {z * 100}%
              </option>
            ))}
          </select>
          <button onClick={() => zoomTo(stepZoom(zoom, 1))} title="Zoom in (+)">
            +
          </button>
          <button onClick={fit} title="Fit the map in the window (0)">
            Fit
          </button>
          <span className="divider" />
          <button
            className={pickingStart ? 'play on' : 'play'}
            aria-pressed={pickingStart}
            onClick={() => setPickingStart((v) => !v)}
            title="Click a cell on the map to start the game there (Esc cancels)"
          >
            ▶ Play from here
          </button>
          <span className="divider" />
          <Toggle
            label="Grid"
            checked={showGrid}
            onChange={setShowGrid}
            title="Show the grid (G)"
          />
          <Toggle label="Events" checked={showEvents} onChange={setShowEvents} />
          <Toggle
            label="Walkable"
            checked={showWalkable}
            onChange={setShowWalkable}
            title="Tint walkable cells green and blocked cells red, as the game sees them (W)"
          />
          <Toggle
            label="Highlight layer"
            checked={highlightActive}
            onChange={setHighlightActive}
            title="Fade the layers you are not working on"
          />
        </div>
        {textures.status === 'ready' && graphics.status !== 'loading' ? (
          <MapCanvas
            map={map}
            tileset={tileset}
            textures={textures.value}
            graphics={graphics.status === 'ready' ? graphics.value : new Map()}
            viewport={viewport}
            options={options}
            hover={hover}
            brush={brush}
            selection={
              tool === 'event'
                ? (map.events.find((e) => e.id === selectedEvent) ?? null)
                : tool === 'select' && area
                  ? areaOnMap(map, area.a, area.b)
                  : null
            }
            walkability={walkability}
            onToolDown={toolDown}
            onToolUp={toolUp}
            onToolCancel={cancelStroke}
            onResize={(width, height) => {
              const view = { width, height };
              setSize(view);
              const b = bounds(view);
              if (b) setViewport((v) => (v ? clampViewport(v, b) : fitViewport(b)));
            }}
            onPan={(dx, dy) => update((view, b) => panBy(view, dx, dy, b))}
            onZoom={(steps, at) => {
              let next = zoom;
              for (let i = 0; i < Math.abs(steps); i++) next = stepZoom(next, steps > 0 ? 1 : -1);
              zoomTo(next, at);
            }}
            onPointerMove={(at) => {
              setHover(
                at && viewport
                  ? screenToTile(
                      viewport,
                      at.sx,
                      at.sy,
                      tileset.tileWidth,
                      tileset.tileHeight,
                      map.width,
                      map.height,
                    )
                  : null,
              );
              const cell = at && cellAt(at);
              if (eventDrag.current && cell) eventMove(cell);
              if (areaDrag.current && cell) setArea((now) => (now ? { a: now.a, b: cell } : now));
              if (stroke.current && cell) {
                stroke.current.moveTo(cell);
                setPreview(stroke.current.preview);
              }
            }}
          />
        ) : (
          <div className="map-canvas centered muted">Loading images…</div>
        )}
        <div className="map-status" aria-live="polite">
          {pickingStart ? (
            <span className="accent-text">
              Click where the player should start{hover ? ` (${hover.x}, ${hover.y})` : ''} · Esc
              cancels
            </span>
          ) : tool === 'event' && !hover ? (
            <span className="muted">
              Click an event to edit it, drag to move it, double-click an empty cell to add one,
              Delete removes it, {MOD}C / {MOD}V copy and paste it
            </span>
          ) : hover ? (
            <>
              <span>
                {hover.x}, {hover.y}
              </span>
              <span>
                {map.layers[activeLayer]?.name}: {describeTile(tileset, hoveredTile)}
              </span>
              {eventsHere.length > 0 && (
                <span>Event: {eventsHere.map((e) => e.name).join(', ')}</span>
              )}
            </>
          ) : (
            <span className="muted">
              {map.width} × {map.height} tiles · Space+drag or scroll to move, Ctrl+scroll or pinch
              to zoom, right-click to pick a tile
            </span>
          )}
        </div>
      </div>

      {tool === 'event' ? (
        <aside className="map-side wide">
          <EventPanel
            doc={doc}
            path={file.path}
            map={map}
            selected={selectedEvent}
            onSelect={setSelectedEvent}
          />
        </aside>
      ) : (
        <aside className="map-side">
          <section>
            <h2>Map</h2>
            <MapSettings doc={doc} path={file.path} map={map} />
          </section>
          <section>
            <h2>Layers</h2>
            <ul className="layers">
              {/* Top layer first, like the drawing order seen from above. */}
              {map.layers
                .map((layer, index) => ({ layer, index }))
                .reverse()
                .map(({ layer, index }) => (
                  <li key={index} className={index === activeLayer ? 'active' : undefined}>
                    <button
                      className="eye"
                      aria-pressed={!hiddenLayers.has(index)}
                      title={hiddenLayers.has(index) ? 'Show layer' : 'Hide layer'}
                      onClick={() => toggleLayer(index)}
                    >
                      {hiddenLayers.has(index) ? '○' : '●'}
                    </button>
                    <button
                      className="layer-name"
                      aria-current={index === activeLayer}
                      onClick={() => setActiveLayer(index)}
                    >
                      {layer.name}
                    </button>
                  </li>
                ))}
            </ul>
          </section>
          <section>
            <h2>Tiles · {tileset.name}</h2>
            {imageUrl.status === 'ready' && (
              <TilePalette
                tileset={tileset}
                imageUrl={imageUrl.value}
                selected={paletteBlock}
                onSelect={(stamp, block) => {
                  setBrushStamp(stamp);
                  setPaletteBlock(block);
                  if (!PAINTS.has(tool)) chooseTool('pencil');
                }}
                width={PALETTE_WIDTH}
              />
            )}
          </section>
        </aside>
      )}
    </div>
  );
}

function Toggle(props: {
  readonly label: string;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
  readonly title?: string;
}) {
  return (
    <label className="toggle" title={props.title}>
      <input
        type="checkbox"
        checked={props.checked}
        onChange={(event) => props.onChange(event.target.checked)}
      />
      {props.label}
    </label>
  );
}
