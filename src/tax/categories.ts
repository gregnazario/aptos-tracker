import type { EntryFunctionCategory } from '../db/queries.js';

export interface ResolvedCategory {
  category: string;
  confidence: number;
  matched_rule: string | null;
}

export function resolveTaxCategory(
  entryFunction: string | null | undefined,
  rules: EntryFunctionCategory[],
): ResolvedCategory {
  if (!entryFunction) {
    return { category: 'unknown', confidence: 0, matched_rule: null };
  }

  // Priority 1: exact match
  for (const rule of rules) {
    if (rule.match_type === 'exact' && rule.pattern === entryFunction) {
      return { category: rule.tax_category, confidence: rule.confidence, matched_rule: rule.pattern };
    }
  }

  // Priority 2: suffix match (e.g. "scripts_v2::swap" matches "0x...::scripts_v2::swap")
  for (const rule of rules) {
    if (rule.match_type === 'suffix' && entryFunction.endsWith(rule.pattern)) {
      return { category: rule.tax_category, confidence: rule.confidence, matched_rule: rule.pattern };
    }
  }

  // Priority 3: contains match
  for (const rule of rules) {
    if (rule.match_type === 'contains' && entryFunction.includes(rule.pattern)) {
      return { category: rule.tax_category, confidence: rule.confidence, matched_rule: rule.pattern };
    }
  }

  return { category: 'unknown', confidence: 0, matched_rule: null };
}
