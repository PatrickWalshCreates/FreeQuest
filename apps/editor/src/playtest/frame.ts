// The sandboxed playtest frame (M15 step 4): the game, plugins included, runs
// here, in an iframe with an opaque origin. It can't see the editor's window,
// storage, files or Tauri; it gets the project only by asking the editor
// (playtest-bridge.ts) and turns asset bytes into its own blob URLs.
import {
  type FrameMessage,
  PLAYTEST_PROTOCOL,
  PlaytestClient,
  type PlaytestStartOptions,
  readHostMessage,
} from '@freequest/editor-core';
import { MemoryStorage, type ProjectSource, startGame } from '@freequest/runtime';

const editor = window.parent;
const post = (message: FrameMessage) => editor.postMessage(message, '*');
const client = new PlaytestClient(post);

const urls = new Map<string, Promise<string>>();
const source: ProjectSource = {
  readJson: (path) => client.readJson(path),
  assetUrl(path) {
    let url = urls.get(path);
    if (!url) {
      url = client
        .readBytes(path)
        .then(({ bytes, type }) => URL.createObjectURL(new Blob([bytes], { type })));
      urls.set(path, url);
    }
    return url;
  },
};

let started = false;

async function start(options: PlaytestStartOptions): Promise<void> {
  const parent = document.getElementById('game');
  if (!parent) throw new Error('The playtest page has no #game element');
  await startGame({
    parent,
    project: source,
    debug: true,
    // Saves live in memory and vanish with the playtest (the frame has no storage anyway).
    saveStorage: new MemoryStorage(),
    plugins: options.plugins,
    ...(options.start ? { start: options.start, skipTitle: true } : {}),
  });
}

window.addEventListener('message', (event) => {
  if (event.source !== editor) return;
  const message = readHostMessage(event.data);
  if (!message) return;
  if (message.type === 'reply') client.receive(message);
  else if (!started) {
    started = true;
    start(message.options).then(
      () => post({ protocol: PLAYTEST_PROTOCOL, type: 'started' }),
      (error: unknown) =>
        post({
          protocol: PLAYTEST_PROTOCOL,
          type: 'failed',
          message: error instanceof Error ? error.message : String(error),
        }),
    );
  }
});

// Cmd/Ctrl+. stops the playtest even while the game has the keyboard.
window.addEventListener('keydown', (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === '.') {
    event.preventDefault();
    post({ protocol: PLAYTEST_PROTOCOL, type: 'stop' });
  }
});

post({ protocol: PLAYTEST_PROTOCOL, type: 'ready' });
