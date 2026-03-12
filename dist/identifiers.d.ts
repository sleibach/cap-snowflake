/**
 * Identifier handling: quoting, casing, schema qualification
 *
 * Design: Snowflake stores unquoted identifiers in UPPERCASE. This adapter
 * normalises all plain identifiers (letters, digits, underscore) to UPPERCASE
 * so that DDL and DML are consistent and case-insensitive on Snowflake.
 * Identifiers containing special characters are double-quoted to preserve them.
 */
import { SnowflakeCredentials } from './config.js';
/**
 * Determine if an identifier needs quoting to preserve its case or special characters.
 *
 * Use this for aliases and key references where the exact string matters.
 * For table/column references use toPhysicalIdentifier instead.
 */
export declare function needsQuoting(identifier: string): boolean;
/**
 * Normalise an identifier to its physical Snowflake form:
 * - Simple identifiers (letters, digits, underscores) → UPPERCASE (unquoted)
 * - Identifiers with special characters → double-quoted (case preserved)
 * - Already-quoted identifiers → returned as-is
 */
export declare function toPhysicalIdentifier(identifier: string): string;
/**
 * Quote an identifier if needed
 */
export declare function quoteIdentifier(identifier: string): string;
/**
 * Fully qualify a table/view name with database and schema.
 * Each name component is normalised via toPhysicalIdentifier so that plain
 * identifiers are UPPERCASE (matching Snowflake's unquoted default).
 */
export declare function qualifyName(name: string, credentials: SnowflakeCredentials, includeSchema?: boolean): string;
/**
 * Extract the simple table name from a qualified name
 */
export declare function getSimpleName(qualifiedName: string): string;
/**
 * Build a column reference with optional table alias
 */
export declare function columnRef(column: string, alias?: string): string;
//# sourceMappingURL=identifiers.d.ts.map