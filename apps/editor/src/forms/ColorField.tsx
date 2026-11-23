// A #rrggbb colour (flashes, tints, windows): the system colour picker plus the
// code. With `noneLabel`, the colour can also be "none" (null), e.g. the
// project's own window colour.
export function ColorField(props: {
  readonly value: unknown;
  readonly onChange: (value: string | null) => void;
  readonly noneLabel?: string;
}) {
  const valid = typeof props.value === 'string' && /^#[0-9a-f]{6}$/i.test(props.value);
  const value = valid ? (props.value as string).toLowerCase() : '#ffffff';
  const none = props.noneLabel !== undefined && props.value === null;
  return (
    <span className="color-field">
      {props.noneLabel !== undefined && (
        <label className="toggle">
          <input
            type="checkbox"
            checked={none}
            onChange={(e) => props.onChange(e.target.checked ? null : value)}
          />
          {props.noneLabel}
        </label>
      )}
      {!none && (
        <>
          <input
            type="color"
            value={value}
            aria-label="Colour"
            onChange={(e) => props.onChange(e.target.value)}
          />
          <code>{value}</code>
        </>
      )}
    </span>
  );
}
