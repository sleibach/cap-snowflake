/**
 * Unit tests for parameter handling and sanitization.
 */

import { expect } from 'chai';
import { sanitizeValue } from '../../src/params.js';

describe('sanitizeValue', () => {
  it('null → NULL', () => {
    expect(sanitizeValue(null)).to.equal('NULL');
  });

  it('undefined → NULL', () => {
    expect(sanitizeValue(undefined)).to.equal('NULL');
  });

  it('true → TRUE', () => {
    expect(sanitizeValue(true)).to.equal('TRUE');
  });

  it('false → FALSE', () => {
    expect(sanitizeValue(false)).to.equal('FALSE');
  });

  it('integer → string integer', () => {
    expect(sanitizeValue(42)).to.equal('42');
  });

  it('float → string float', () => {
    expect(sanitizeValue(3.14)).to.equal('3.14');
  });

  it('throws for Infinity', () => {
    expect(() => sanitizeValue(Infinity)).to.throw();
  });

  it('string → single-quoted, escaping apostrophes', () => {
    expect(sanitizeValue("it's")).to.equal("'it''s'");
  });

  it('plain string → single-quoted', () => {
    expect(sanitizeValue('hello')).to.equal("'hello'");
  });

  it('Date → ISO string in single quotes', () => {
    const d = new Date('2024-01-15T10:00:00.000Z');
    const result = sanitizeValue(d);
    expect(result).to.include('2024-01-15');
    expect(result).to.match(/^'.*'$/);
  });

  it('Array → ARRAY_CONSTRUCT', () => {
    const result = sanitizeValue([1, 2, 3]);
    expect(result).to.equal('ARRAY_CONSTRUCT(1, 2, 3)');
  });

  it('nested Array → nested ARRAY_CONSTRUCT', () => {
    const result = sanitizeValue([[1, 2], [3, 4]]);
    expect(result).to.include('ARRAY_CONSTRUCT');
  });

  it('object → PARSE_JSON', () => {
    const result = sanitizeValue({ key: 'value' });
    expect(result).to.include('PARSE_JSON');
    expect(result).to.include('key');
  });
});
