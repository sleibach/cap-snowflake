/**
 * CQN ORDER BY translation
 */

import { quoteIdentifier } from '../identifiers.js';

export interface OrderByItem {
  ref?: string[];
  sort?: 'asc' | 'desc';
  nulls?: 'first' | 'last';
}

/**
 * Translate ORDER BY clause
 */
export function translateOrderBy(orderBy: OrderByItem[]): string {
  if (!orderBy || orderBy.length === 0) {
    return '';
  }

  const clauses = orderBy.map(item => translateOrderByItem(item));
  return `ORDER BY ${clauses.join(', ')}`;
}

/**
 * Translate single ORDER BY item
 */
function translateOrderByItem(item: OrderByItem): string {
  let clause = '';

  if (item.ref) {
    clause = item.ref.map(part => toPhysicalIdentifier(part)).join('.');
  } else {
    // Fallback to string representation
    clause = String(item);
  }

  // Add sort direction
  if (item.sort) {
    clause += ` ${item.sort.toUpperCase()}`;
  }

  // Add NULLS FIRST/LAST if specified
  if (item.nulls) {
    clause += ` NULLS ${item.nulls.toUpperCase()}`;
  }

  return clause;
}

function toPhysicalIdentifier(identifier: string): string {
  if (!identifier) return identifier;
  if (identifier === '*') return identifier;
  if (identifier.startsWith('"') && identifier.endsWith('"')) return identifier;
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    return identifier.toUpperCase();
  }
  return quoteIdentifier(identifier);
}

