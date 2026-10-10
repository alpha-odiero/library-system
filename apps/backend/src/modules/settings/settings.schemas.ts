import { z } from 'zod';

/**
 * Administrative settings request schemas.
 *
 * These are the `SETTINGS_VIEW` / `SETTINGS_UPDATE` side of the module. They are
 * deliberately separate from `GET /public`: the public slice is a projection
 * controlled by the `is_public` flag in the database, while everything here is
 * gated at the route level and only reachable by a principal holding the
 * permission.
 */

/** Optional category narrowing for the grouped listing. */
export const settingsListQuerySchema = z
  .object({
    category: z.string().trim().min(1).max(50).optional(),
  })
  .strict();

/**
 * The write body: `{ updates: { [key]: value } }`.
 *
 * Each value is validated against the row's declared `valueType` by
 * `updateSetting` — the schema here only constrains shape, count and key length,
 * because type coercion must live next to the row that declares the type.
 */
export const settingsUpdateSchema = z
  .object({
    updates: z
      .record(z.string().trim().min(1).max(100), z.unknown())
      .refine((entries) => Object.keys(entries).length > 0, {
        message: 'Provide at least one setting to update',
      }),
  })
  .strict();

export type SettingsListQuery = z.infer<typeof settingsListQuerySchema>;
export type SettingsUpdateBody = z.infer<typeof settingsUpdateSchema>;
