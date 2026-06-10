/**
 * FoxMatter Badge Engine
 * Generates badges based on conditions and priorities
 */

import {
  BadgeProfile,
  BadgeDefinition,
  Badge,
  ContentMetadata,
  EvaluationContext,
  ValidationResult,
} from '../types';

/**
 * BadgeEngine: Condition evaluation and badge generation
 * 
 * Features:
 * - Safe condition evaluation
 * - Priority-based sorting
 * - Conflict resolution
 * - Badge deduplication
 * - Performance caching
 */
export class BadgeEngine {
  private conditionCache: Map<string, Function> = new Map();
  private maxCacheSize = 500;
  private evaluationTimeout = 3000; // 3 seconds
  private maxBadgesPerItem = 10;

  /**
   * Generate badges for a content item
   */
  public getBadges(
    item: ContentMetadata,
    profile: BadgeProfile,
    addon?: { id: string; name: string; version: string }
  ): Badge[] {
    try {
      const context: EvaluationContext = {
        item,
        addon: addon || { id: 'unknown', name: 'unknown', version: '0.0.0' },
        now: Date.now(),
      };

      // Evaluate each badge definition
      const matchedBadges: Badge[] = [];

      for (const badgeDef of profile.badges) {
        if (!badgeDef.enabled) continue;

        try {
          if (this.evaluateCondition(badgeDef.condition, context)) {
            matchedBadges.push({
              id: badgeDef.id,
              name: badgeDef.name,
              label: badgeDef.appearance.label,
              icon: badgeDef.appearance.icon,
              color: badgeDef.appearance.color,
              backgroundColor: badgeDef.appearance.backgroundColor,
              position: badgeDef.appearance.position,
              priority: badgeDef.priority,
              source: 'badge-engine',
            });
          }
        } catch (error) {
          console.error(`Badge ${badgeDef.id} evaluation error:`, error);
          continue;
        }
      }

      // Sort by priority and apply limits
      const sorted = this.sortBadges(matchedBadges, profile.options?.sortDirection);
      const maxBadges = profile.options?.maxBadges ?? this.maxBadgesPerItem;
      const limited = sorted.slice(0, maxBadges);

      // Handle duplicates
      if (!profile.options?.allowDuplicates) {
        return this.deduplicateBadges(limited);
      }

      return limited;
    } catch (error) {
      console.error('Badge generation error:', error);
      return [];
    }
  }

  /**
   * Evaluate a condition expression
   */
  private evaluateCondition(condition: string, context: EvaluationContext): boolean {
    if (!condition) return false;

    try {
      // Check cache
      let evaluator = this.conditionCache.get(condition);
      if (!evaluator) {
        evaluator = this.compileCondition(condition);
        if (this.conditionCache.size < this.maxCacheSize) {
          this.conditionCache.set(condition, evaluator);
        }
      }

      return evaluator(context);
    } catch (error) {
      console.error('Condition evaluation error:', error);
      return false;
    }
  }

  /**
   * Compile condition to evaluator function
   */
  private compileCondition(condition: string): Function {
    const sanitized = this.sanitizeCondition(condition);

    // Build safe scope
    const scopeKeys = [
      'item',
      'addon',
      'user',
      'now',
      // Helper functions
      'includes',
      'startsWith',
      'endsWith',
      'contains',
      'any',
      'all',
      'match',
      'test',
    ];

    return function evaluateCondition(context: EvaluationContext): boolean {
      const scope = {
        item: context.item,
        addon: context.addon,
        user: context.user,
        now: context.now,
        // Helper functions
        includes: (str: any, substr: string) => String(str || '').includes(substr),
        startsWith: (str: any, prefix: string) => String(str || '').startsWith(prefix),
        endsWith: (str: any, suffix: string) => String(str || '').endsWith(suffix),
        contains: (arr: any[], value: any) => Array.isArray(arr) && arr.includes(value),
        any: (arr: any[], fn: Function) => Array.isArray(arr) && arr.some(fn),
        all: (arr: any[], fn: Function) => Array.isArray(arr) && arr.every(fn),
        match: (str: any, pattern: string) => {
          try {
            const regex = new RegExp(pattern);
            return regex.test(String(str || ''));
          } catch {
            return false;
          }
        },
        test: (value: any) => Boolean(value),
      };

      try {
        const fn = new Function(...scopeKeys, `return ${sanitized}`);
        return Boolean(fn(...scopeKeys.map(k => scope[k as keyof typeof scope])));
      } catch {
        return false;
      }
    };
  }

  /**
   * Sanitize condition to prevent code injection
   */
  private sanitizeCondition(condition: string): string {
    const forbidden = [
      'eval',
      'Function',
      'setTimeout',
      'setInterval',
      'import',
      'require',
      '__proto__',
      'constructor',
      'prototype',
    ];

    let safe = condition;

    for (const word of forbidden) {
      safe = safe.replace(new RegExp(`\\b${word}\\b`, 'gi'), '');
    }

    return safe;
  }

  /**
   * Sort badges by priority
   */
  private sortBadges(
    badges: Badge[],
    direction: 'asc' | 'desc' = 'desc'
  ): Badge[] {
    const sorted = [...badges].sort((a, b) => {
      if (direction === 'asc') {
        return a.priority - b.priority;
      } else {
        return b.priority - a.priority;
      }
    });

    return sorted;
  }

  /**
   * Remove duplicate badges (keep first occurrence)
   */
  private deduplicateBadges(badges: Badge[]): Badge[] {
    const seen = new Set<string>();
    const deduped: Badge[] = [];

    for (const badge of badges) {
      const key = `${badge.id}:${badge.label}`;
      if (!seen.has(key)) {
        deduped.push(badge);
        seen.add(key);
      }
    }

    return deduped;
  }

  /**
   * Validate a badge profile
   */
  public validateProfile(profile: BadgeProfile): ValidationResult {
    const errors: any[] = [];
    const warnings: any[] = [];
    const startTime = Date.now();

    // Validate structure
    if (!profile.version) {
      errors.push({
        path: 'version',
        message: 'Version is required',
        code: 'MISSING_VERSION',
      });
    }

    if (!Array.isArray(profile.badges)) {
      errors.push({
        path: 'badges',
        message: 'Badges must be an array',
        code: 'INVALID_TYPE',
      });
      return {
        valid: false,
        errors,
        warnings,
        metadata: { validatedAt: Date.now(), duration: Date.now() - startTime },
      };
    }

    // Validate each badge
    for (let i = 0; i < profile.badges.length; i++) {
      const badge = profile.badges[i];
      const badgePath = `badges[${i}]`;

      // Required fields
      if (!badge.id) {
        errors.push({
          path: `${badgePath}.id`,
          message: 'Badge ID is required',
          code: 'MISSING_FIELD',
        });
      }

      if (!badge.name) {
        errors.push({
          path: `${badgePath}.name`,
          message: 'Badge name is required',
          code: 'MISSING_FIELD',
        });
      }

      if (!badge.condition) {
        errors.push({
          path: `${badgePath}.condition`,
          message: 'Badge condition is required',
          code: 'MISSING_FIELD',
        });
      }

      if (!badge.appearance) {
        errors.push({
          path: `${badgePath}.appearance`,
          message: 'Badge appearance is required',
          code: 'MISSING_FIELD',
        });
      } else if (!badge.appearance.label) {
        errors.push({
          path: `${badgePath}.appearance.label`,
          message: 'Badge label is required',
          code: 'MISSING_FIELD',
        });
      }

      // Validate condition syntax
      if (badge.condition) {
        try {
          this.compileCondition(badge.condition);
        } catch (error: any) {
          errors.push({
            path: `${badgePath}.condition`,
            message: `Invalid condition: ${error.message}`,
            code: 'INVALID_CONDITION',
          });
        }
      }

      // Validate priority
      if (typeof badge.priority !== 'number' || badge.priority < 0) {
        warnings.push({
          path: `${badgePath}.priority`,
          message: 'Priority should be a non-negative number',
          code: 'INVALID_PRIORITY',
        });
      }

      // Validate color format
      if (badge.appearance.color && !this.isValidColor(badge.appearance.color)) {
        warnings.push({
          path: `${badgePath}.appearance.color`,
          message: 'Invalid color format',
          code: 'INVALID_COLOR',
        });
      }
    }

    // Validate options
    if (profile.options) {
      if (typeof profile.options.maxBadges !== 'undefined') {
        if (typeof profile.options.maxBadges !== 'number' || profile.options.maxBadges < 1) {
          errors.push({
            path: 'options.maxBadges',
            message: 'maxBadges must be a positive number',
            code: 'INVALID_VALUE',
          });
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      metadata: { validatedAt: Date.now(), duration: Date.now() - startTime },
    };
  }

  /**
   * Check if color is valid
   */
  private isValidColor(color: string): boolean {
    // Valid hex color
    if (/^#[0-9a-fA-F]{6}$/.test(color)) return true;
    // Valid CSS color name (basic check)
    if (/^[a-z]+$/i.test(color)) return true;
    // RGB/RGBA
    if (/^rgba?\(/.test(color)) return true;
    return false;
  }

  /**
   * Clear condition cache
   */
  public clearCache(): void {
    this.conditionCache.clear();
  }

  /**
   * Get cache statistics
   */
  public getCacheStats(): { size: number; maxSize: number } {
    return {
      size: this.conditionCache.size,
      maxSize: this.maxCacheSize,
    };
  }
}

export default BadgeEngine;
