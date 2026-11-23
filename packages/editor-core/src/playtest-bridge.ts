// Messages between the editor and its sandboxed playtest frame (M15 step 4).
//
// Playtests run the game, plugins included, in an iframe with
// `sandbox="allow-scripts"`: an opaque origin with no access to the editor's
// window, its storage, Tauri's IPC or the dev server. The frame gets the
// project only through these messages: it asks for a JSON file or an asset's
// bytes, the editor answers from the playtest snapshot. Everything the frame
// sends is treated as untrusted (plugin code runs there), so every message is
// checked here before the editor acts on it.
import { normalizeProjectPath } from './paths.js';
import type { PlaytestSource } from './playtest.js';

/** Tags every message, so stray `postMessage`s (browser extensions…) are ignored. */
export const PLAYTEST_PROTOCOL = 'freequest-playtest-1';

/** Where the frame may read bytes from: assets and plugin scripts, nothing else. */
const BYTE_FOLDERS = ['assets/', 'plugins/'];

export interface PlaytestStartOptions {
  /** Start on this map tile instead of the title screen. */
  readonly start: { readonly map: string; readonly x: number; readonly y: number } | null;
  /** Run the project's enabled plugins. */
  readonly plugins: boolean;
}

/** What the frame sends the editor. */
export type FrameMessage =
  | { readonly protocol: typeof PLAYTEST_PROTOCOL; readonly type: 'ready' }
  | {
      readonly protocol: typeof PLAYTEST_PROTOCOL;
      readonly type: 'request';
      readonly id: number;
      readonly op: 'json' | 'bytes';
      readonly path: string;
    }
  | { readonly protocol: typeof PLAYTEST_PROTOCOL; readonly type: 'started' }
  | {
      readonly protocol: typeof PLAYTEST_PROTOCOL;
      readonly type: 'failed';
      readonly message: string;
    }
  | { readonly protocol: typeof PLAYTEST_PROTOCOL; readonly type: 'stop' };

export type FrameRequest = Extract<FrameMessage, { type: 'request' }>;

/** What the editor sends the frame. */
export type HostMessage =
  | {
      readonly protocol: typeof PLAYTEST_PROTOCOL;
      readonly type: 'start';
      readonly options: PlaytestStartOptions;
    }
  | {
      readonly protocol: typeof PLAYTEST_PROTOCOL;
      readonly type: 'reply';
      readonly id: number;
      readonly ok: true;
      /** JSON data, or for `bytes` `{ bytes, type }` (an ArrayBuffer and a MIME type). */
      readonly value: unknown;
    }
  | {
      readonly protocol: typeof PLAYTEST_PROTOCOL;
      readonly type: 'reply';
      readonly id: number;
      readonly ok: false;
      readonly error: string;
    };

export interface AssetBytes {
  readonly bytes: ArrayBuffer;
  readonly type: string;
}

const MAX_MESSAGE_TEXT = 10_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Read a message from the frame, or null if it isn't a well-formed one.
 * Only plain fields are read and copied, so nothing the frame sent (getters,
 * odd prototypes) reaches the editor's code.
 */
export function readFrameMessage(data: unknown): FrameMessage | null {
  if (!isRecord(data) || data['protocol'] !== PLAYTEST_PROTOCOL) return null;
  const protocol = PLAYTEST_PROTOCOL;
  switch (data['type']) {
    case 'ready':
    case 'started':
    case 'stop':
      return { protocol, type: data['type'] };
    case 'failed': {
      const message = data['message'];
      if (typeof message !== 'string') return null;
      return { protocol, type: 'failed', message: message.slice(0, MAX_MESSAGE_TEXT) };
    }
    case 'request': {
      const { id, op, path } = data;
      if (typeof id !== 'number' || !Number.isSafeInteger(id)) return null;
      if (op !== 'json' && op !== 'bytes') return null;
      if (typeof path !== 'string' || path.length > 1000) return null;
      return { protocol, type: 'request', id, op, path };
    }
    default:
      return null;
  }
}

/** Read a message from the editor (in the frame), or null if it isn't one. */
export function readHostMessage(data: unknown): HostMessage | null {
  if (!isRecord(data) || data['protocol'] !== PLAYTEST_PROTOCOL) return null;
  if (data['type'] === 'start' && isRecord(data['options'])) return data as HostMessage;
  if (data['type'] === 'reply' && typeof data['id'] === 'number') return data as HostMessage;
  return null;
}

const MIME_TYPES: Readonly<Record<string, string>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  mp3: 'audio/mpeg',
  ttf: 'font/ttf',
  otf: 'font/otf',
  woff: 'font/woff',
  woff2: 'font/woff2',
  js: 'text/javascript',
  mjs: 'text/javascript',
  json: 'application/json',
};

/** The MIME type a blob of this file needs (scripts must be JavaScript to import). */
export function mimeTypeFor(path: string): string {
  const extension = /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase() ?? '';
  return MIME_TYPES[extension] ?? 'application/octet-stream';
}

/** What the frame can ask for: the snapshot's JSON and raw bytes. */
export type PlaytestFiles = Pick<PlaytestSource, 'readJson' | 'readBytes'>;

/**
 * The editor's side: answers the frame's requests from the playtest snapshot.
 * Paths are checked like any project path (nothing outside the project), JSON
 * only for `.json` files and bytes only under assets/ and plugins/.
 */
export class PlaytestHost {
  constructor(private readonly files: PlaytestFiles) {}

  async answer(request: FrameRequest): Promise<HostMessage> {
    const protocol = PLAYTEST_PROTOCOL;
    const { id } = request;
    try {
      return { protocol, type: 'reply', id, ok: true, value: await this.read(request) };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { protocol, type: 'reply', id, ok: false, error: message };
    }
  }

  private async read({ op, path: raw }: FrameRequest): Promise<unknown> {
    const path = normalizeProjectPath(raw);
    if (op === 'json') {
      if (!path.endsWith('.json')) throw new Error(`${path}: not a JSON file`);
      return this.files.readJson(path);
    }
    if (!BYTE_FOLDERS.some((folder) => path.startsWith(folder))) {
      throw new Error(`${path}: playtests read files under assets/ and plugins/ only`);
    }
    const data = await this.files.readBytes(path);
    // A fresh buffer holding exactly these bytes, so it can be transferred.
    const bytes = new ArrayBuffer(data.byteLength);
    new Uint8Array(bytes).set(data);
    const value: AssetBytes = { bytes, type: mimeTypeFor(path) };
    return value;
  }
}

/**
 * The frame's side: turns reads into requests and matches the editor's
 * replies to them. `post` sends a message to the editor.
 */
export class PlaytestClient {
  private next = 1;
  private readonly waiting = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();

  constructor(private readonly post: (message: FrameMessage) => void) {}

  readJson(path: string): Promise<unknown> {
    return this.request('json', path);
  }

  async readBytes(path: string): Promise<AssetBytes> {
    const value = await this.request('bytes', path);
    if (!isRecord(value) || !(value['bytes'] instanceof ArrayBuffer)) {
      throw new Error(`${path}: the editor sent no bytes`);
    }
    return { bytes: value['bytes'], type: String(value['type']) };
  }

  /** Handle a reply; false if it answers nothing this client asked. */
  receive(message: HostMessage): boolean {
    if (message.type !== 'reply') return false;
    const waiter = this.waiting.get(message.id);
    if (!waiter) return false;
    this.waiting.delete(message.id);
    if (message.ok) waiter.resolve(message.value);
    else waiter.reject(new Error(message.error));
    return true;
  }

  private request(op: 'json' | 'bytes', path: string): Promise<unknown> {
    const id = this.next++;
    return new Promise((resolve, reject) => {
      this.waiting.set(id, { resolve, reject });
      this.post({ protocol: PLAYTEST_PROTOCOL, type: 'request', id, op, path });
    });
  }
}
