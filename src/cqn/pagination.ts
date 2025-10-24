/**
 * CQN pagination ($top, $skip, $count) translation
 */

export interface PaginationOptions {
  top?: number;
  skip?: number;
  count?: boolean;
}

/**
 * Translate LIMIT/OFFSET clause
 */
export function translatePagination(options: PaginationOptions): string {
  const parts: string[] = [];

  if (options.top !== undefined && options.top >= 0) {
    parts.push(`LIMIT ${options.top}`);
  }

  if (options.skip !== undefined && options.skip > 0) {
    parts.push(`OFFSET ${options.skip}`);
  }

  return parts.join(' ');
}

/**
 * Wrap query with COUNT
 */
export function wrapWithCount(sql: string): string {
  return `SELECT COUNT(*) AS "count" FROM (${sql}) AS "countQuery"`;
}

