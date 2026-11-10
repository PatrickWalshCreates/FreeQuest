import {
  type JsonSchema,
  classify,
  defaultFor,
  variantIndex,
  variantLabel,
} from '@freequest/editor-core';
import { useState } from 'react';
import { Dialog } from '../Dialog.js';
import { type FormContext, ObjectFields } from '../forms/SchemaField.js';

interface Props<T> {
  readonly title: string;
  /** An object schema, or a union of object schemas (the dialog offers the variants). */
  readonly schema: JsonSchema;
  readonly initial: T;
  readonly ctx: FormContext;
  /** Checks the edited value; a message blocks OK. */
  readonly validate: (value: T) => string | null;
  readonly okLabel: string;
  /** For a union: what to call each variant in the "kind" dropdown. */
  readonly variantName?: (label: string) => string;
  readonly onOk: (value: T) => void;
  readonly onClose: () => void;
}

/**
 * Edit one value (a command, a condition) in a dialog. Nothing changes in
 * the document until OK, so a whole edit is one undo step.
 */
export function ValueDialog<T>(props: Props<T>) {
  const [value, setValue] = useState<T>(props.initial);
  const problem = props.validate(value);
  const shape = classify(props.schema);
  const variants = shape.kind === 'union' ? shape.variants : null;
  const index = variants ? variantIndex(variants, value) : 0;
  const objectSchema = variants ? (variants[index] ?? {}) : props.schema;
  return (
    <Dialog title={props.title} onClose={props.onClose}>
      <form
        className="form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!problem) props.onOk(value);
        }}
      >
        {variants && (
          <div className="schema-field">
            <label htmlFor="value-kind">Kind</label>
            <select
              id="value-kind"
              value={index}
              onChange={(e) => {
                const next = variants[Number(e.target.value)];
                if (next) setValue(defaultFor(next, props.ctx.pick) as T);
              }}
            >
              {variants.map((v, i) => (
                <option key={i} value={i}>
                  {props.variantName?.(variantLabel(v)) ?? variantLabel(v)}
                </option>
              ))}
            </select>
          </div>
        )}
        {variants || shape.kind === 'object' ? (
          <ObjectFields
            schema={objectSchema}
            value={value as Readonly<Record<string, unknown>>}
            onChange={(v) => setValue(v as T)}
            ctx={props.ctx}
          />
        ) : null}
        {problem && <p className="error">{problem}</p>}
        <div className="actions">
          <button type="button" onClick={props.onClose}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={problem !== null}>
            {props.okLabel}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
