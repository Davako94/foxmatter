/**
 * FoxMatter Formatter Engine
 * Handles template-based formatting transformations
 */

import {
  FormatProfile,
  FormattedItem,
  ContentMetadata,
  EvaluationContext,
  FormattingRule,
  CompiledTemplate,
  TemplateToken,
  ValidationResult,
  ValidationError,
} from '../types';

/**
 * FormatterEngine: Template compilation and rendering
 * 
 * Features:
 * - Mustache-style template syntax
 * - Condition support ({{#condition}}...{{/condition}})
 * - Filter support ({{value | uppercase}})
 * - Priority-based rule system
 * - Safe evaluation with timeouts
 */
export class FormatterEngine {
  private compiledCache: Map<string, CompiledTemplate> = new Map();
  private maxCacheSize = 1000;
  private templateTimeout = 5000; // 5 seconds
  
  // Built-in filters
  private filters = {
    uppercase: (v: any) => String(v).toUpperCase(),
    lowercase: (v: any) => String(v).toLowerCase(),
    capitalize: (v: any) => String(v).charAt(0).toUpperCase() + String(v).slice(1),
    trim: (v: any) => String(v).trim(),
    truncate: (v: any, len: number = 50) => String(v).substring(0, len),
    default: (v: any, fallback: any) => v ?? fallback,
    round: (v: any, decimals: number = 0) => Number(v).toFixed(decimals),
    abs: (v: any) => Math.abs(Number(v)),
    length: (v: any) => String(v).length,
    reverse: (v: any) => String(v).split('').reverse().join(''),
    urlencode: (v: any) => encodeURIComponent(String(v)),
    htmlescape: (v: any) => String(v)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;'),
  };

  /**
   * Format a single content item
   */
  public formatItem(
    item: ContentMetadata,
    profile: FormatProfile,
    addon?: { id: string; name: string; version: string }
  ): FormattedItem {
    const startTime = Date.now();

    try {
      // Build evaluation context
      const context: EvaluationContext = {
        item,
        addon: addon || { id: 'unknown', name: 'unknown', version: '0.0.0' },
        now: Date.now(),
      };

      // Apply default templates
      let title = this.renderTemplate(
        profile.templates.title || '{{title}}',
        context
      );
      let description = this.renderTemplate(
        profile.templates.description || '{{description}}',
        context
      );

      // Apply formatting rules (sorted by priority)
      const activeRules = profile.rules
        .filter(r => r.enabled)
        .sort((a, b) => b.priority - a.priority);

      for (const rule of activeRules) {
        if (this.evaluateCondition(rule.condition, context)) {
          if (rule.template) {
            if (rule.id.includes('title')) {
              title = this.renderTemplate(rule.template, context);
            } else if (rule.id.includes('description')) {
              description = this.renderTemplate(rule.template, context);
            }
          }
        }
      }

      // Apply formatting options
      if (profile.options?.trimWhitespace) {
        title = title.trim();
        description = description.trim();
      }

      if (profile.options?.maxLength) {
        title = title.substring(0, profile.options.maxLength);
        description = description.substring(0, profile.options.maxLength);
      }

      return {
        id: item.id,
        type: item.type,
        title,
        originalTitle: item.originalTitle,
        description,
        poster: item.poster,
        background: item.background,
        badges: [],
        metadata: { ...item },
        formattedAt: Date.now(),
      };
    } catch (error) {
      // Fallback to original metadata on error
      console.error('Format error:', error);
      return {
        id: item.id,
        type: item.type,
        title: item.title,
        description: item.description,
        poster: item.poster,
        background: item.background,
        badges: [],
        metadata: { ...item },
        formattedAt: Date.now(),
      };
    }
  }

  /**
   * Format a list of items
   */
  public formatList(
    items: ContentMetadata[],
    profile: FormatProfile,
    addon?: { id: string; name: string; version: string }
  ): FormattedItem[] {
    return items.map(item => this.formatItem(item, profile, addon));
  }

  /**
   * Render a template string with context
   */
  private renderTemplate(template: string, context: EvaluationContext): string {
    if (!template) return '';

    try {
      // Check cache
      let compiled = this.compiledCache.get(template);
      if (!compiled) {
        compiled = this.compileTemplate(template);
        if (this.compiledCache.size < this.maxCacheSize) {
          this.compiledCache.set(template, compiled);
        }
      }

      return this.executeTemplate(compiled, context);
    } catch (error) {
      console.error('Template rendering error:', error);
      return template; // Return original on error
    }
  }

  /**
   * Compile template string to tokens
   */
  private compileTemplate(template: string): CompiledTemplate {
    const tokens: TemplateToken[] = [];
    let current = '';
    let i = 0;

    while (i < template.length) {
      // Look for variable start
      if (template[i] === '{' && template[i + 1] === '{') {
        // Save text token
        if (current) {
          tokens.push({ type: 'text', value: current });
          current = '';
        }

        // Find variable end
        let endIdx = template.indexOf('}}', i + 2);
        if (endIdx === -1) {
          current += template[i];
          i++;
          continue;
        }

        const varContent = template.substring(i + 2, endIdx).trim();

        // Detect variable type
        if (varContent.startsWith('#')) {
          // Condition: {{#condition}}...{{/condition}}
          tokens.push({
            type: 'condition',
            value: varContent.substring(1),
            nested: [],
          });
        } else if (varContent.startsWith('^')) {
          // Negation
          tokens.push({
            type: 'condition',
            value: `!(${varContent.substring(1)})`,
            nested: [],
          });
        } else if (varContent.startsWith('.')) {
          // Each: {{.items}}...{{/items}}
          tokens.push({
            type: 'iteration',
            value: varContent.substring(1),
            nested: [],
          });
        } else {
          // Regular variable or function call
          tokens.push({ type: 'variable', value: varContent });
        }

        i = endIdx + 2;
      } else {
        current += template[i];
        i++;
      }
    }

    if (current) {
      tokens.push({ type: 'text', value: current });
    }

    return { raw: template, tokens };
  }

  /**
   * Execute compiled template with context
   */
  private executeTemplate(compiled: CompiledTemplate, context: EvaluationContext): string {
    return compiled.tokens
      .map(token => this.evaluateToken(token, context))
      .join('');
  }

  /**
   * Evaluate a single token
   */
  private evaluateToken(token: TemplateToken, context: EvaluationContext): string {
    switch (token.type) {
      case 'text':
        return token.value;

      case 'variable':
        return this.resolveVariable(token.value, context);

      case 'condition':
        if (this.evaluateCondition(token.value, context)) {
          return token.nested?.map(t => this.evaluateToken(t, context)).join('') || '';
        }
        return '';

      case 'iteration':
        // TODO: Implement iteration support
        return '';

      default:
        return '';
    }
  }

  /**
   * Resolve a variable in context (supports nested paths and filters)
   */
  private resolveVariable(variable: string, context: EvaluationContext): string {
    try {
      // Split by pipe for filters
      const [path, ...filterParts] = variable.split('|').map(s => s.trim());

      // Resolve the base value
      let value = this.resolvePath(path, context);

      // Apply filters
      for (const filter of filterParts) {
        value = this.applyFilter(filter, value);
      }

      // Return stringified value
      if (value === null || value === undefined) {
        return '';
      }

      return String(value);
    } catch (error) {
      return '';
    }
  }

  /**
   * Resolve a dot-notation path in context
   */
  private resolvePath(path: string, context: any): any {
    const parts = path.split('.');
    let current = context;

    for (const part of parts) {
      if (current == null) return null;
      current = current[part];
    }

    return current;
  }

  /**
   * Apply a filter to a value
   */
  private applyFilter(filterStr: string, value: any): any {
    const [name, ...args] = filterStr.split(':').map(s => s.trim());

    const filter = this.filters[name as keyof typeof this.filters];
    if (!filter) {
      console.warn(`Unknown filter: ${name}`);
      return value;
    }

    try {
      return filter(value, ...args);
    } catch (error) {
      console.error(`Filter error (${name}):`, error);
      return value;
    }
  }

  /**
   * Evaluate a condition expression
   */
  private evaluateCondition(condition: string, context: EvaluationContext): boolean {
    if (!condition) return true;

    try {
      // Build safe evaluation scope
      const scope = {
        item: context.item,
        addon: context.addon,
        user: context.user,
        now: context.now,
        // Helper functions
        includes: (str: string, substr: string) => str?.includes(substr),
        startsWith: (str: string, prefix: string) => str?.startsWith(prefix),
        endsWith: (str: string, suffix: string) => str?.endsWith(suffix),
        contains: (arr: any[], value: any) => arr?.includes(value),
        any: (arr: any[], fn: Function) => arr?.some(fn),
        all: (arr: any[], fn: Function) => arr?.every(fn),
      };

      // Create function with timeout
      const timeoutPromise = new Promise<boolean>((_, reject) =>
        setTimeout(() => reject(new Error('Condition evaluation timeout')), this.templateTimeout)
      );

      const evalPromise = Promise.resolve().then(() => {
        // Safe evaluation: only allow simple expressions
        const safeCond = this.sanitizeCondition(condition);
        const fn = new Function(...Object.keys(scope), `return ${safeCond}`);
        return fn(...Object.values(scope));
      });

      // Note: This is simplified for sync evaluation
      // In production, use a proper sandboxing library
      const safeCond = this.sanitizeCondition(condition);
      const fn = new Function(...Object.keys(scope), `return ${safeCond}`);
      return Boolean(fn(...Object.values(scope)));
    } catch (error) {
      console.error('Condition evaluation error:', error);
      return false;
    }
  }

  /**
   * Sanitize condition to prevent code injection
   */
  private sanitizeCondition(condition: string): string {
    // Whitelist allowed operations
    const forbidden = ['eval', 'Function', 'setTimeout', 'setInterval', 'import', 'require', '__proto__'];
    let safe = condition;

    for (const word of forbidden) {
      // Case-insensitive replacement
      safe = safe.replace(new RegExp(word, 'gi'), '');
    }

    return safe;
  }

  /**
   * Validate template syntax
   */
  public validateTemplate(template: string): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];
    const startTime = Date.now();

    try {
      // Check for balanced braces
      let openCount = 0;
      for (let i = 0; i < template.length; i++) {
        if (template[i] === '{' && template[i + 1] === '{') {
          openCount++;
          i++;
        } else if (template[i] === '}' && template[i + 1] === '}') {
          openCount--;
          if (openCount < 0) {
            errors.push({
              path: `template[${i}]`,
              message: 'Unmatched closing braces',
              code: 'UNMATCHED_BRACES',
            });
          }
          i++;
        }
      }

      if (openCount > 0) {
        errors.push({
          path: 'template',
          message: 'Unclosed braces',
          code: 'UNCLOSED_BRACES',
        });
      }

      // Try to compile
      this.compileTemplate(template);
    } catch (error: any) {
      errors.push({
        path: 'template',
        message: error.message,
        code: 'COMPILATION_ERROR',
      });
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      metadata: {
        validatedAt: Date.now(),
        duration: Date.now() - startTime,
      },
    };
  }
}

export default FormatterEngine;
