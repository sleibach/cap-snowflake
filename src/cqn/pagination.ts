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
 * Strip LIMIT / OFFSET clause from the end of a SQL string.
 * Used to obtain the unpaginated SQL for a COUNT(*) query.
 */
export function stripPagination(sql: string): string {
  // Remove trailing LIMIT n and/or OFFSET m (case-insensitive, any order)
  return sql.replace(/\s+(LIMIT\s+\d+(\s+OFFSET\s+\d+)?|OFFSET\s+\d+(\s+LIMIT\s+\d+)?)$/i, '');
}

/**
 * Wrap query with COUNT — sql must NOT contain LIMIT/OFFSET.
 */
export function wrapWithCount(sql: string): string {
  return `SELECT COUNT(*) AS "count" FROM (${sql}) AS "countQuery"`;
}

