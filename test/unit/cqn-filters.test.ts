/**
 * Unit tests for CQN filter translation
 */

import { expect } from 'chai';
import { translateFilter } from '../../src/cqn/filters.js';

describe('CQN Filter Translation', () => {
  it('should translate simple equality', () => {
    const params: any[] = [];
    const xpr = [{ ref: ['title'] }, '=', { val: 'Test Book' }];
    const result = translateFilter(xpr, params);
    
    expect(result).to.equal('title = ?');
    expect(params).to.deep.equal(['Test Book']);
  });

  it('should translate comparison operators', () => {
    let params: any[] = [];
    let xpr = [{ ref: ['price'] }, '<', { val: 20 }];
    let result = translateFilter(xpr, params);
    expect(result).to.equal('price < ?');
    expect(params).to.deep.equal([20]);

    params = [];
    xpr = [{ ref: ['price'] }, '>=', { val: 10 }];
    result = translateFilter(xpr, params);
    expect(result).to.equal('price >= ?');
    expect(params).to.deep.equal([10]);
  });

  it('should translate AND/OR logic', () => {
    const params: any[] = [];
    const xpr = [
      { ref: ['price'] }, '>', { val: 10 },
      'and',
      { ref: ['stock'] }, '>', { val: 0 }
    ];
    const result = translateFilter(xpr, params);
    
    expect(result).to.equal('price > ? AND stock > ?');
    expect(params).to.deep.equal([10, 0]);
  });

  it('should translate IN operator', () => {
    const params: any[] = [];
    const xpr = [
      { ref: ['status'] },
      'in',
      { list: [{ val: 'active' }, { val: 'pending' }] }
    ];
    const result = translateFilter(xpr, params);
    
    expect(result).to.equal('status in (?, ?)');
    expect(params).to.deep.equal(['active', 'pending']);
  });

  it('should translate BETWEEN operator', () => {
    const params: any[] = [];
    const xpr = [
      { ref: ['price'] },
      'between',
      { val: 10 },
      'and',
      { val: 50 }
    ];
    const result = translateFilter(xpr, params);
    
    expect(result).to.include('between');
    expect(params).to.deep.equal([10, 50]);
  });

  it('should translate LIKE operator', () => {
    const params: any[] = [];
    const xpr = [{ ref: ['title'] }, 'like', { val: '%test%' }];
    const result = translateFilter(xpr, params);
    
    expect(result).to.equal('title LIKE ?');
    expect(params).to.deep.equal(['%test%']);
  });

  it('should translate IS NULL', () => {
    const params: any[] = [];
    const xpr = [{ ref: ['author'] }, 'is', { val: null }];
    const result = translateFilter(xpr, params);
    
    expect(result).to.equal('author IS NULL');
  });

  it('should translate nested expressions', () => {
    const params: any[] = [];
    const xpr = [
      { xpr: [{ ref: ['price'] }, '>', { val: 10 }] },
      'or',
      { xpr: [{ ref: ['featured'] }, '=', { val: true }] }
    ];
    const result = translateFilter(xpr, params);
    
    expect(result).to.equal('(price > ?) OR (featured = ?)');
    expect(params).to.deep.equal([10, true]);
  });

  it('should translate functions', () => {
    const params: any[] = [];
    const xpr = [
      { func: 'lower', args: [{ ref: ['title'] }] },
      '=',
      { val: 'test' }
    ];
    const result = translateFilter(xpr, params);
    
    expect(result).to.equal('LOWER(title) = ?');
    expect(params).to.deep.equal(['test']);
  });
});

