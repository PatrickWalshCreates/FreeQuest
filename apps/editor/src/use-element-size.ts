import { type RefObject, useEffect, useState } from 'react';

/** An element's inner size (minus `padding` on each side), kept current as it resizes. */
export function useElementSize(
  ref: RefObject<HTMLElement | null>,
  padding = 0,
  initial = { width: 640, height: 480 },
): { width: number; height: number } {
  const [size, setSize] = useState(initial);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(() =>
      setSize({
        width: element.clientWidth - 2 * padding,
        height: element.clientHeight - 2 * padding,
      }),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, padding]);
  return size;
}
