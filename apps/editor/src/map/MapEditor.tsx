import { CollisionMap } from '@freequest/core';
import {
  type ProjectDocument,
  type ProjectFile,
  type TileCell,
  TileStroke,
  type TileTool,
  type Viewport,
  type ViewportBounds,
  ZOOM_LEVELS,
  clampViewport,
  fitViewport,
  panBy,
  screenToTile,
  screenToWorld,
  stepZoom,
  tileAt,
  zoomAt,
} from '@freequest/editor-core';
import { EMPTY_TILE, type GameMap } from '@freequest/schema';
import { useMemo, useRef, useState } from 'react';
import { type CanvasPoint, MapCanvas } from './MapCanvas.js';
import { TilePalette, describeTile } from './TilePalette.js';
import { identityKey, loadCharacter, loadTileTextures, useLoaded } from './graphics.js';
import type { RenderOptions } from './map-renderer.js';

interface Props {
  readonly doc: ProjectDocument;
  readonly file: ProjectFile<'map'> & { readonly data: GameMap };
}

const PALETTE_WIDTH = 256;

const TOOLS: readonly { id: TileTool; label: string; key: string; hint: string }[] = [
  { id: 'pencil', label: 'Pencil', key: 'b', hint: 'Paint tiles by clicking or dragging' },
  { id: 'rectangle', label: 'Rectangle', key: 'r', hint: 'Drag to fill a rectangle' },
  { id: 'fill', label: 'Fill', key: 'f', hint: 'Fill the connected area of the same tile' },
  { id: 'eraser', label: 'Eraser', key: 'e', hint: 'Clear tiles on this layer' },
  { id: 'eyedropper', label: 'Pick', key: 'i', hint: 'Pick a tile from the map (or right-click)' },
];

/** Tools that paint the palette's tile, so the brush shows it under the pointer. */
const PAINTS = new Set<TileTool>(['pencil', 'rectangle', 'fill']);

/** The map editor: canvas, view controls, layers and the tile palette. */
export function MapEditor({ doc, file }: Props) {
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
  const [selectedTile, setSelectedTile] = useState(0);
  const [tool, setTool] = useState<TileTool>('pencil');
  const [showWalkable, setShowWalkable] = useState(false);
  const stroke = useRef<TileStroke | null>(null);
  const [preview, setPreview] = useState<readonly TileCell[] | null>(null);

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
      { doc, path: file.path, layer: activeLayer, tool: 'eyedropper', tile: selectedTile },
      cell,
    ).picked;
    if (picked !== null && picked !== EMPTY_TILE) setSelectedTile(picked);
  };
  const toolDown = (at: CanvasPoint, how: { readonly pick: boolean }) => {
    const cell = cellAt(at);
    if (!cell) return;
    if (how.pick || tool === 'eyedropper') {
      pick(cell);
      if (tool === 'eyedropper') setTool('pencil');
      return;
    }
    stroke.current = new TileStroke(
      { doc, path: file.path, layer: activeLayer, tool, tile: selectedTile },
      cell,
    );
    setPreview(stroke.current.preview);
  };
  const toolUp = () => {
    stroke.current?.finish();
    stroke.current = null;
    setPreview(null);
  };
  const cancelStroke = () => {
    stroke.current?.cancel();
    stroke.current = null;
    setPreview(null);
  };
  const chooseTool = (next: TileTool) => {
    if (stroke.current) return;
    setTool(next);
  };

  // `preview` is non-null exactly while a stroke is in progress.
  const brush: readonly TileCell[] =
    preview && preview.length > 0
      ? preview
      : hover && !preview && PAINTS.has(tool)
        ? [{ ...hover, tile: selectedTile }]
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
        if (event.target instanceof HTMLInputElement || event.metaKey || event.ctrlKey) return;
        const key = event.key.toLowerCase();
        const shortcut = TOOLS.find((t) => t.key === key);
        if (key === 'escape' && stroke.current) cancelStroke();
        else if (shortcut) chooseTool(shortcut.id);
        else if (key === '=' || key === '+') zoomTo(stepZoom(zoom, 1));
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
          {hover ? (
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

      <aside className="map-side">
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
              selected={selectedTile}
              onSelect={(tile) => {
                setSelectedTile(tile);
                if (!PAINTS.has(tool)) chooseTool('pencil');
              }}
              width={PALETTE_WIDTH}
            />
          )}
        </section>
      </aside>
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
