/**
 * `text`, shortened with "…" until `measure` says it fits in `maxWidth`
 * (whole text if it already fits; just "…" if nothing else does). Free of
 * PixiJS so it can be tested; views pass a measure that sets a Text's text
 * and reads its width.
 */
export function fitText(text: string, maxWidth: number, measure: (text: string) => number): string {
  if (measure(text) <= maxWidth) return text;
  const chars = [...text];
  // Longest prefix that fits with the ellipsis, by binary search.
  let low = 0;
  let high = chars.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (measure(`${chars.slice(0, mid).join('').trimEnd()}…`) <= maxWidth) low = mid;
    else high = mid - 1;
  }
  return `${chars.slice(0, low).join('').trimEnd()}…`;
}
