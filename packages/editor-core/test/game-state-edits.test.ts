import { describe, expect, it } from 'vitest';
import type { Manifest } from '@freequest/schema';
import { addDeclaration, removeDeclaration, renameDeclaration } from '../src/index.js';

const base = { switches: [{ id: 'door', name: 'Door' }], variables: [] } as unknown as Manifest;

describe('switches and variables', () => {
  it('adds with an id made from the name, never one already used by either list', () => {
    const a = addDeclaration(base, 'switches', 'Door');
    expect(a.id).toBe('door-2');
    const b = addDeclaration(a.manifest, 'variables', '  Coins found ');
    expect(b.id).toBe('coins-found');
    expect(b.manifest.variables).toEqual([{ id: 'coins-found', name: 'Coins found' }]);
    expect(addDeclaration(base, 'variables', 'Door').id).toBe('door-2');
    expect(addDeclaration(base, 'switches', '★').id).toBe('switch');
    expect(() => addDeclaration(base, 'switches', '  ')).toThrow(/name/);
  });

  it('renames the display name only, and removes', () => {
    const renamed = renameDeclaration(base, 'switches', 'door', 'Front door open');
    expect(renamed.switches).toEqual([{ id: 'door', name: 'Front door open' }]);
    expect(renameDeclaration(base, 'switches', 'nope', 'x')).toBe(base);
    expect(removeDeclaration(base, 'switches', 'door').switches).toEqual([]);
    expect(removeDeclaration(base, 'variables', 'door')).toBe(base);
  });
});
