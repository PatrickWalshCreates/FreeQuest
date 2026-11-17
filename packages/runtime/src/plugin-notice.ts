// A small notice over the game when a plugin stops working, so neither the
// player nor the game's maker is left wondering why rain never started. The
// game keeps running; the notice closes with its button.

/** Show `message` in a notice inside `parent` (several stack). Returns a function that removes it. */
export function showPluginNotice(parent: HTMLElement, message: string): () => void {
  let stack = parent.querySelector<HTMLElement>(':scope > .freequest-plugin-notices');
  if (!stack) {
    stack = document.createElement('div');
    stack.className = 'freequest-plugin-notices';
    Object.assign(stack.style, {
      position: 'absolute',
      left: '8px',
      right: '8px',
      bottom: '8px',
      display: 'flex',
      flexDirection: 'column',
      gap: '6px',
      zIndex: '20',
      pointerEvents: 'none',
    });
    if (getComputedStyle(parent).position === 'static') parent.style.position = 'relative';
    parent.appendChild(stack);
  }
  const notice = document.createElement('div');
  notice.setAttribute('role', 'alert');
  Object.assign(notice.style, {
    display: 'flex',
    gap: '8px',
    alignItems: 'flex-start',
    padding: '8px 10px',
    borderRadius: '6px',
    background: 'rgba(40, 20, 20, 0.92)',
    color: '#ffe8e0',
    font: '13px/1.4 system-ui, sans-serif',
    pointerEvents: 'auto',
  });
  const text = document.createElement('span');
  text.style.flex = '1';
  text.textContent = message;
  const close = document.createElement('button');
  close.type = 'button';
  close.textContent = '×';
  close.setAttribute('aria-label', 'Close');
  Object.assign(close.style, {
    background: 'none',
    border: 'none',
    color: 'inherit',
    font: 'inherit',
    fontSize: '16px',
    cursor: 'pointer',
    lineHeight: '1',
  });
  const remove = () => notice.remove();
  close.addEventListener('click', remove);
  notice.append(text, close);
  stack.appendChild(notice);
  return remove;
}
