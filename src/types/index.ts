/**
 * FoxMatter Core Types
 * Centralized type definitions for the entire system
 */

// ============================================================
// Profile Types
// ============================================================

export interface Profile<T extends ProfileConfig = any> {
  id: string;
  version: string;
  name: string;
  description?: string;
  type: 'format' | 'badge' | 'mapping';
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
  author?: string;
  tags?: string[];
  config: T;
  syncId?: string;
  lastSyncedAt?: number;
  isCloudBacked?: boolean;
}

export type ProfileConfig = FormatProfile | BadgeProfile | AddonMapping;

export interface FormatProfile {
  version: '1.0.0';
  templates: {
    title?: string;
    description?: string;
    meta?: string;
    poster?: string;
    background?: string;
    [key: string]: string | undefined;
  };
  rules: FormattingRule[];
  options: FormatOptions;
}

export interface BadgeProfile {
  version: '1.0.0';
  badges: BadgeDefinition[];
  options: BadgeOptions;
}

export interface FormattingRule {
  id: string;
  name: string;
  enabled: boolean;
  condition: string;
  template?: string;
  priority: number;
}

export interface BadgeDefinition {
  id: string;
  name: string;
  enabled: boolean;
  condition: string;
  appearance: BadgeAppearance;
  priority: number;
}

export interface BadgeAppearance {
  label: string;
  icon?: string;
  color?: string;
  backgroundColor?: string;
  position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  fontSize?: number;
  fontWeight?: 'normal' | 'bold' | 'lighter';
}

export interface FormatOptions {
  trimWhitespace?: boolean;
  stripHtml?: boolean;
  maxLength?: number;
  encoding?: 'utf-8' | 'ascii';
  nullBehavior?: 'omit' | 'empty' | 'default';
}

export interface BadgeOptions {
  maxBadges?: number;
  conflictResolution?: 'first' | 'last' | 'highest-priority';
  allowDuplicates?: boolean;
  sortDirection?: 'asc' | 'desc';
}

// ============================================================
// Content Metadata Types
// ============================================================

export interface ContentMetadata {
  id: string;
  type: 'movie' | 'series' | 'anime' | 'documentary';
  title: string;
  originalTitle?: string;
  year?: number;
  description?: string;
  poster?: string;
  posterShape?: 'poster' | 'landscape';
  background?: string;
  rating?: number;
  ratingCount?: number;
  ratingSource?: string;
  genres?: string[];
  director?: string[];
  cast?: string[];
  duration?: number;
  releaseDate?: string;
  imdbId?: string;
  tmdbId?: string;
  traktId?: string;
  
  // Media-specific
  resolution?: '720p' | '1080p' | '2160p' | '4K';
  hdr?: boolean;
  dolbyVision?: boolean;
  audioTracks?: number;
  subtitles?: string[];
  
  // Extended
  videos?: Video[];
  streams?: Stream[];
  castList?: CastMember[];
  
  // Custom
  [key: string]: any;
}

export interface Video {
  id: string;
  title?: string;
  season?: number;
  episode?: number;
  released?: string;
  thumbnail?: string;
  overview?: string;
}

export interface Stream {
  name: string;
  url: string;
  type?: string;
  quality?: string;
  sources?: string[];
}

export interface CastMember {
  name: string;
  character?: string;
  profileUrl?: string;
}

export interface FormattedItem {
  id: string;
  type: ContentMetadata['type'];
  title: string;
  originalTitle?: string;
  description?: string;
  poster?: string;
  background?: string;
  badges: Badge[];
  metadata: Record<string, any>;
  formattedAt: number;
}

export interface Badge {
  id: string;
  name: string;
  label: string;
  icon?: string;
  color?: string;
  backgroundColor?: string;
  position?: BadgeAppearance['position'];
  priority: number;
  source: 'badge-engine' | 'addon' | 'custom';
}

// ============================================================
// Engine & Evaluation Types
// ============================================================

export interface EvaluationContext {
  item: ContentMetadata;
  addon: {
    id: string;
    name: string;
    version: string;
  };
  user?: {
    locale: string;
    timezone: string;
    preferences?: Record<string, any>;
  };
  now: number;
  [key: string]: any;
}

export interface CompiledProfile {
  id: string;
  profile: FormatProfile | BadgeProfile;
  compiled: boolean;
  compiledAt: number;
  templates?: Map<string, CompiledTemplate>;
  rules?: Map<string, CompiledRule>;
}

export interface CompiledTemplate {
  raw: string;
  tokens: TemplateToken[];
}

export interface TemplateToken {
  type: 'text' | 'variable' | 'condition' | 'iteration' | 'function';
  value: string;
  nested?: TemplateToken[];
}

export interface CompiledRule {
  id: string;
  condition: Function;
  template: CompiledTemplate | null;
  priority: number;
}

// ============================================================
// Addon Types
// ============================================================

export interface Addon {
  id: string;
  name: string;
  version: string;
  description: string;
  logo?: string;
  background?: string;
  types: string[];
  catalogs: CatalogEntry[];
  resources: AddonResource[];
  transportUrl?: string;
  configUrl?: string;
}

export interface CatalogEntry {
  type: string;
  id: string;
  name: string;
  extra?: CatalogExtra[];
}

export interface CatalogExtra {
  name: string;
  isRequired?: boolean;
  options?: string[];
  optionsLimit?: number;
}

export interface AddonResource {
  name: string;
  types: string[];
  idPrefixes?: string[];
}

export interface AddonMapping {
  addonId: string;
  formatProfileId?: string;
  badgeProfileId?: string;
  enabled: boolean;
  priority: number;
  contentTypeOverrides?: Record<string, {
    formatProfileId?: string;
    badgeProfileId?: string;
  }>;
}

// ============================================================
// Validation Types
// ============================================================

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
  metadata: {
    validatedAt: number;
    duration: number;
  };
}

export interface ValidationError {
  path: string;
  message: string;
  code: string;
  value?: any;
  expected?: any;
}

export interface ValidationWarning {
  path: string;
  message: string;
  code: string;
}

// ============================================================
// Storage Types
// ============================================================

export interface StorageQuery {
  type?: 'format' | 'badge';
  tags?: string[];
  author?: string;
  enabled?: boolean;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface ProfileMetadata {
  id: string;
  size: number;
  lastModified: number;
  accessCount: number;
  lastAccessed: number;
}

export interface StorageTransaction {
  begin(): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  save(profile: Profile): Promise<void>;
  delete(id: string): Promise<void>;
}

// ============================================================
// Filter & Function Types
// ============================================================

export type FilterFunction = (value: any, ...args: any[]) => any;
export type ConditionEvaluator = (context: EvaluationContext) => boolean;
export type TemplateRenderer = (context: EvaluationContext) => string;

// ============================================================
// Migration Types
// ============================================================

export interface Migration {
  version: string;
  name: string;
  up(profile: Profile): Profile;
  down(profile: Profile): Profile;
}

export interface MigrationResult {
  success: boolean;
  fromVersion: string;
  toVersion: string;
  changes: string[];
  duration: number;
}

// ============================================================
// API Types
// ============================================================

export interface ApiRequest<T = any> {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  path: string;
  headers: Record<string, string>;
  body?: T;
}

export interface ApiResponse<T = any> {
  status: number;
  headers: Record<string, string>;
  body: T;
  timestamp: number;
  duration: number;
}

export interface ErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: Record<string, any>;
  };
}

export interface SuccessResponse<T = any> {
  success: true;
  data: T;
  metadata?: {
    version: string;
    timestamp: number;
  };
}
