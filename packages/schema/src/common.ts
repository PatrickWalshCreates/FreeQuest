import Type, { type Static } from 'typebox';

/** Identifier used to reference one project file from another (e.g. a map's tileset). */
export const Id = Type.String({
  pattern: '^[a-z0-9][a-z0-9_-]*$',
  description: 'Lowercase identifier: letters, digits, "_" and "-".',
});

/** Path relative to the project root, always using forward slashes. Assets are never embedded. */
export const RelativePath = Type.String({
  pattern: '^(?!/)(?![a-zA-Z]:)(?!.*\\\\)[^\\0]+$',
  description: 'Path relative to the project root, using "/" separators.',
});

export const Direction = Type.Union([
  Type.Literal('down'),
  Type.Literal('left'),
  Type.Literal('right'),
  Type.Literal('up'),
]);
export type Direction = Static<typeof Direction>;

export const PositiveInt = Type.Integer({ minimum: 1 });
export const NonNegativeInt = Type.Integer({ minimum: 0 });

/** A reference from the manifest to a data file. */
export const FileRef = Type.Object(
  {
    id: Id,
    path: RelativePath,
  },
  { additionalProperties: false },
);
export type FileRef = Static<typeof FileRef>;
