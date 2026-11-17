// HUD: a small box in a corner of the screen showing the party's gold or a
// variable. An example FreeQuest plugin (MIT, like FreeQuest).
//
// Its settings pick what it shows, its label and corner, and optionally a
// switch it waits for. "Hide the HUD" and "Show the HUD" turn it off and on
// for a while (a cutscene, say); that's kept in saves.

const PADDING = 4;
const MARGIN = 4;
const FONT_SIZE = 10;

export default {
  setup(api) {
    const { what, variable, label, corner, onlyWhile } = api.settings;
    let hidden = false;

    const read = (game) => {
      const data = game.getData();
      hidden = !!(data && typeof data === 'object' && data.hidden === true);
    };
    api.onGameStart(read);

    api.command('hide', ({ game }) => {
      hidden = true;
      game.setData({ hidden: true });
    });
    api.command('show', ({ game }) => {
      hidden = false;
      game.setData(undefined);
    });

    api.onDraw(({ context, width, height, game }) => {
      if (hidden) return;
      if (onlyWhile && !game.getSwitch(onlyWhile)) return;
      const value =
        what === 'gold'
          ? game.gold
          : variable
            ? game.getVariable(variable)
            : '(no variable chosen)';
      const text = label ? `${label} ${value}` : String(value);

      context.font = `${FONT_SIZE}px sans-serif`;
      context.textBaseline = 'middle';
      const boxWidth = Math.ceil(context.measureText(text).width) + PADDING * 2;
      const boxHeight = FONT_SIZE + PADDING * 2;
      const x = corner.endsWith('right') ? width - boxWidth - MARGIN : MARGIN;
      const y = corner.startsWith('bottom') ? height - boxHeight - MARGIN : MARGIN;

      context.fillStyle = 'rgba(12, 14, 24, 0.78)';
      context.fillRect(x, y, boxWidth, boxHeight);
      context.strokeStyle = 'rgba(255, 255, 255, 0.35)';
      context.lineWidth = 1;
      context.strokeRect(x + 0.5, y + 0.5, boxWidth - 1, boxHeight - 1);
      context.fillStyle = '#ffffff';
      context.fillText(text, x + PADDING, y + boxHeight / 2 + 1);
    });
  },
};
