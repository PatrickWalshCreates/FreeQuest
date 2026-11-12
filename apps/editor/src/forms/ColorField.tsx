// A #rrggbb colour (flashes, tints): the system colour picker plus the code.
export function ColorField(props: {
  readonly value: unknown;
  readonly onChange: (value: string) => void;
}) {
  const value =
    typeof props.value === 'string' && /^#[0-9a-f]{6}$/i.test(props.value)
      ? props.value.toLowerCase()
      : '#ffffff';
  return (
    <span className="color-field">
      <input
        type="color"
        value={value}
        aria-label="Colour"
        onChange={(e) => props.onChange(e.target.value)}
      />
      <code>{value}</code>
    </span>
  );
}
