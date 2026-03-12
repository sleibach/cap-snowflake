/**
 * Localization support for Snowflake adapter
 * Handles localized entities and .texts table generation
 */
import { SnowflakeCredentials } from '../config.js';
export interface LocalizedElement {
    name: string;
    type: string;
    length?: number;
    localized: boolean;
}
export interface LocalizedEntity {
    entityName: string;
    localizedElements: LocalizedElement[];
    keys: string[];
}
/**
 * Generate .texts table for localized entity
 */
export declare function generateTextsTable(entity: LocalizedEntity, credentials: SnowflakeCredentials): string;
/**
 * Generate localized view for entity
 */
export declare function generateLocalizedView(entity: LocalizedEntity, credentials: SnowflakeCredentials, defaultLocale?: string): string;
/**
 * Check if entity has localized elements
 */
export declare function hasLocalizedElements(entity: any): boolean;
/**
 * Extract localized elements from entity definition
 */
export declare function extractLocalizedElements(entity: any): LocalizedElement[];
/**
 * Get entity keys
 */
export declare function getEntityKeys(entity: any): string[];
//# sourceMappingURL=localized.d.ts.map