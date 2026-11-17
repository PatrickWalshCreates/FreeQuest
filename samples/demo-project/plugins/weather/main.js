// Weather: rain or snow over a map. An example FreeQuest plugin (MIT, like FreeQuest).
//
// "Start weather" makes it rain or snow on the map the player is on; it stays
// with that map (it's kept in saves) until "Stop weather", and other maps stay
// dry. Drops are drawn over the map with Canvas 2D and move with the camera.

/** How many drops a density of 1 means at full strength. */
const DROPS_PER_DENSITY = 24;

/** A repeatable random number in 0–1 for drop `n` (so drops don't jump between frames). */
function random(n) {
  const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/** `value` wrapped into 0–`size`. */
function wrap(value, size) {
  return ((value % size) + size) % size;
}

/** What's saved: the map it's on, rain or snow, and how strong (0–1). Null when clear. */
function readWeather(data) {
  if (!data || typeof data !== 'object') return null;
  const { map, kind, strength } = data;
  if (typeof map !== 'string' || (kind !== 'rain' && kind !== 'snow')) return null;
  return { map, kind, strength: Math.min(1, Math.max(0, Number(strength) || 0)) };
}

export default {
  setup(api) {
    const density = api.settings.density;
    let weather = null;
    /** The strength on screen now: it eases toward the weather's over `fadeSeconds`. */
    let shown = 0;
    let shownKind = 'rain';
    let fadeSeconds = 1;

    const target = (game) => (weather && weather.map === game.map.id ? weather.strength : 0);

    // A new game has no weather; a loaded one has what its save kept. Either way, no fade.
    api.onGameStart((game) => {
      weather = readWeather(game.getData());
      shown = target(game);
      if (weather) shownKind = weather.kind;
    });
    // Arriving on a map shows its weather at once (stepping indoors leaves the rain outside).
    api.onMapLoaded((game) => {
      shown = target(game);
    });
    api.onStep((game, dt) => {
      const goal = target(game);
      const change = fadeSeconds > 0 ? dt / fadeSeconds : 1;
      shown = goal > shown ? Math.min(goal, shown + change) : Math.max(goal, shown - change);
    });

    api.command('start', ({ args, game }) => {
      weather = { map: game.map.id, kind: args.kind, strength: args.strength };
      game.setData(weather);
      fadeSeconds = args.seconds;
      // Switching between rain and snow starts the new one from clear.
      if (shownKind !== weather.kind) shown = 0;
      shownKind = weather.kind;
      if (fadeSeconds === 0) shown = weather.strength;
    });
    api.command('stop', ({ args, game }) => {
      weather = null;
      game.setData(undefined);
      fadeSeconds = args.seconds;
      if (fadeSeconds === 0) shown = 0;
    });

    api.onDraw(({ context, width, height, camera, seconds }) => {
      if (shown <= 0.001) return;
      const count = Math.round(DROPS_PER_DENSITY * density * shown);
      if (shownKind === 'rain') {
        // A grey-blue sky over everything, then slanted streaks.
        context.fillStyle = `rgba(30, 40, 70, ${0.3 * shown})`;
        context.fillRect(0, 0, width, height);
        context.strokeStyle = 'rgba(205, 220, 255, 0.8)';
        context.lineWidth = 1;
        context.beginPath();
        const w = width + 40;
        const h = height + 40;
        for (let i = 0; i < count; i++) {
          const speed = 280 + 160 * random(i * 3 + 2);
          const x = Math.round(wrap(random(i * 3) * w - camera.x - seconds * speed * 0.3, w) - 20);
          const y = Math.round(wrap(random(i * 3 + 1) * h - camera.y + seconds * speed, h) - 20);
          context.moveTo(x + 0.5, y);
          context.lineTo(x - 3.5, y + 11);
        }
        context.stroke();
      } else {
        context.fillStyle = `rgba(220, 230, 255, ${0.12 * shown})`;
        context.fillRect(0, 0, width, height);
        context.fillStyle = 'rgba(255, 255, 255, 0.9)';
        const w = width + 20;
        const h = height + 20;
        for (let i = 0; i < count; i++) {
          const speed = 18 + 22 * random(i * 3 + 2);
          const sway = Math.sin(seconds * 1.3 + i) * 6;
          const x = Math.round(wrap(random(i * 3) * w - camera.x + sway + seconds * 6, w) - 10);
          const y = Math.round(wrap(random(i * 3 + 1) * h - camera.y + seconds * speed, h) - 10);
          const size = random(i * 3 + 2) > 0.6 ? 2 : 1;
          context.fillRect(x, y, size, size);
        }
      }
    });
  },
};
