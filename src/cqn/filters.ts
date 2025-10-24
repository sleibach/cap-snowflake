/**
 * CQN filter/where clause translation to SQL
 */

import { quoteIdentifier } from '../identifiers.js';
import { placeholder } from '../params.js';

export interface CQNExpression {
  ref?: string[];
  val?: any;
  func?: string;
  args?: CQNExpression[];
  xpr?: any[];
  list?: any[];
}

/**
 * Translate CQN where/having expression to SQL
 */
export function translateFilter(xpr: any[], params: any[]): string {
  if (!xpr || xpr.length === 0) {
    return '';
  }

  return translateExpression(xpr, params);
}

/**
 * Translate a CQN expression
 */
function translateExpression(xpr: any[], params: any[]): string {
  const parts: string[] = [];

  for (let i = 0; i < xpr.length; i++) {
    const element = xpr[i];

    // String operators: 'and', 'or', '=', '!=', etc.
    if (typeof element === 'string') {
      parts.push(translateOperator(element));
    }
    // Object: ref, val, func, xpr, list
    else if (typeof element === 'object' && element !== null) {
      if (element.ref) {
        parts.push(translateRef(element.ref));
      } else if ('val' in element) {
        parts.push(translateVal(element.val, params));
      } else if (element.func) {
        parts.push(translateFunc(element, params));
      } else if (element.xpr) {
        parts.push(`(${translateExpression(element.xpr, params)})`);
      } else if (element.list) {
        parts.push(translateList(element.list, params));
      }
    }
  }

  return parts.join(' ');
}

/**
 * Translate operator
 */
function translateOperator(op: string): string {
  const opUpper = op.toUpperCase();
  
  switch (opUpper) {
    case 'AND':
    case 'OR':
    case 'NOT':
      return opUpper;
    case '=':
    case '!=':
    case '<>':
    case '<':
    case '<=':
    case '>':
    case '>=':
      return op;
    case 'LIKE':
    case 'IN':
    case 'BETWEEN':
    case 'IS':
      return opUpper;
    default:
      return op;
  }
}

/**
 * Translate reference (column name)
 */
function translateRef(ref: string[]): string {
  if (ref.length === 1) {
    return quoteIdentifier(ref[0]);
  }

  // Multiple parts: table.column or alias.column
  return ref.map(part => quoteIdentifier(part)).join('.');
}

/**
 * Translate value
 */
function translateVal(val: any, params: any[]): string {
  if (val === null) {
    return 'NULL';
  }

  // Add to parameter array and return placeholder
  params.push(val);
  return placeholder();
}

/**
 * Translate function call
 */
function translateFunc(func: CQNExpression, params: any[]): string {
  const funcName = func.func!.toUpperCase();
  const args = func.args || [];

  switch (funcName) {
    case 'LOWER':
    case 'UPPER':
    case 'LENGTH':
      return `${funcName}(${translateExpression(args as any[], params)})`;
    
    case 'SUBSTRING':
      // SUBSTRING(str, start, length)
      if (args.length >= 2) {
        const str = translateExpression([args[0]] as any[], params);
        const start = translateExpression([args[1]] as any[], params);
        const len = args[2] ? translateExpression([args[2]] as any[], params) : undefined;
        if (len) {
          return `SUBSTRING(${str}, ${start}, ${len})`;
        }
        return `SUBSTRING(${str}, ${start})`;
      }
      break;
    
    case 'CONTAINS':
      // CONTAINS(str, substr) -> str LIKE '%substr%'
      if (args.length === 2) {
        const str = translateExpression([args[0]] as any[], params);
        // For contains, we need to wrap the value with %
        const containsVal = (args[1] as any).val;
        if (containsVal !== undefined) {
          params.push(`%${containsVal}%`);
          return `${str} LIKE ${placeholder()}`;
        }
      }
      break;
    
    case 'STARTSWITH':
      // STARTSWITH(str, prefix) -> str LIKE 'prefix%'
      if (args.length === 2) {
        const str = translateExpression([args[0]] as any[], params);
        const startsVal = (args[1] as any).val;
        if (startsVal !== undefined) {
          params.push(`${startsVal}%`);
          return `${str} LIKE ${placeholder()}`;
        }
      }
      break;
    
    case 'ENDSWITH':
      // ENDSWITH(str, suffix) -> str LIKE '%suffix'
      if (args.length === 2) {
        const str = translateExpression([args[0]] as any[], params);
        const endsVal = (args[1] as any).val;
        if (endsVal !== undefined) {
          params.push(`%${endsVal}`);
          return `${str} LIKE ${placeholder()}`;
        }
      }
      break;
    
    case 'YEAR':
    case 'MONTH':
    case 'DAY':
      return `${funcName}(${translateExpression(args as any[], params)})`;
    
    default:
      // Generic function call
      return `${funcName}(${args.map(arg => translateExpression([arg] as any[], params)).join(', ')})`;
  }

  // Fallback
  return `${funcName}(${args.map(arg => translateExpression([arg] as any[], params)).join(', ')})`;
}

/**
 * Translate list (for IN operator)
 */
function translateList(list: any[], params: any[]): string {
  const values = list.map(item => {
    if (item.val !== undefined) {
      params.push(item.val);
      return placeholder();
    }
    return translateExpression([item], params);
  });

  return `(${values.join(', ')})`;
}

