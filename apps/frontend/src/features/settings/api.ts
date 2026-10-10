import { api } from '../../lib/api';

/**
 * Settings — public and administrative.
 *
 * The public slice (`GET /settings/public`) is served before login and only
 * carries rows flagged `is_public` in the database. Everything below is the
 * administrative surface, gated by `SETTINGS_VIEW` / `SETTINGS_UPDATE`, whose
 * writes are all audit-logged with the before/after diff.
 */

export type SettingsValueType = 'string' | 'number' | 'boolean' | 'json';

export interface SettingDto {
  key: string;
  value: unknown;
  valueType: SettingsValueType;
  description: string | null;
  isPublic: boolean;
  updatedAt: string;
}

export interface SettingsCategoryDto {
  category: string;
  settings: SettingDto[];
}

export function getPublicSettings(signal?: AbortSignal) {
  return api.get<Record<string, unknown>>('/settings/public', signal ? { signal } : {});
}

/** Every setting, grouped by category. Optionally narrowed to one category. */
export function getSettings(category?: string, signal?: AbortSignal) {
  return api.get<{ settings: SettingsCategoryDto[] }>('/settings', {
    query: category ? { category } : {},
    ...(signal ? { signal } : {}),
  });
}

export interface SavedSettingDto {
  key: string;
  value: unknown;
  valueType: SettingsValueType;
  description: string | null;
}

/** Updates one or more settings in a single write. Every key is validated first. */
export function updateSettings(updates: Record<string, unknown>) {
  return api.patch<{ settings: SavedSettingDto[] }>('/settings', { updates });
}
