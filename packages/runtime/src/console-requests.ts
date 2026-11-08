import type { World } from '@freequest/core';

/**
 * TEMPORARY (until M2 step 4 adds the message box and choice window):
 * answers interpreter requests immediately and logs them to the console, so
 * events can run without freezing the player.
 */
export function answerRequestsInConsole(world: World): void {
  const interpreter = world.interpreter;
  const request = interpreter?.pending;
  if (!interpreter || !request) return;
  const source = world.interpreterEvent ? `[${world.interpreterEvent.id}]` : '[event]';
  switch (request.type) {
    case 'message':
      console.info(source, request.speaker ? `${request.speaker}: ${request.text}` : request.text);
      interpreter.continue();
      break;
    case 'choice': {
      const index = 0;
      console.info(
        source,
        `choice [${request.options.join(' | ')}] → auto-picked "${request.options[index]}"`,
      );
      interpreter.choose(index);
      break;
    }
    case 'transfer':
      console.info(
        source,
        `transfer to ${request.map} (${request.x}, ${request.y}) not implemented yet`,
      );
      interpreter.continue();
      break;
  }
}
