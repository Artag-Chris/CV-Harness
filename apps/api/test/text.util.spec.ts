import { describe, expect, it } from 'vitest';
import { cleanDescription } from '../src/common/text.util';

describe('cleanDescription', () => {
  it('quita tags y conserva párrafos', () => {
    const input =
      '<p>Buscamos <strong>NestJS</strong>.</p><ul><li>Req 1</li><li>Req 2</li></ul>';
    const out = cleanDescription(input);
    expect(out).toContain('Buscamos NestJS.');
    expect(out).toContain('Req 1');
    expect(out).not.toContain('<');
  });

  it('decodifica entidades', () => {
    const out = cleanDescription('Node &amp; React &lt;3&nbsp; ');
    expect(out).toContain('Node & React');
  });

  it('colapsa líneas en blanco', () => {
    const out = cleanDescription('hola\n\n\n   mundo\n\n');
    expect(out).toBe('hola\nmundo');
  });
});
