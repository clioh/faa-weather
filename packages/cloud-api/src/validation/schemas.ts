import { z } from 'zod';

// Module configuration schema (flexible for different module types)
export const moduleConfigSchema = z.object({
  instanceId: z.string().uuid(),
  moduleType: z.string().min(1),
  position: z.enum([
    'top_bar',
    'top_left',
    'top_center',
    'top_right',
    'upper_third',
    'middle_center',
    'lower_third',
    'bottom_left',
    'bottom_center',
    'bottom_right',
    'bottom_bar',
    'fullscreen_above',
    'fullscreen_below',
  ]),
  config: z.record(z.string(), z.unknown()).optional(),
  disabled: z.boolean().optional(),
  order: z.number().int().optional(),
});

export const modulesArraySchema = z.array(moduleConfigSchema);

// Layout schemas
export const createLayoutSchema = z.object({
  name: z.string().min(1).max(100),
  modules: modulesArraySchema.default([]),
  isActive: z.boolean().optional(),
});

export const updateLayoutSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  modules: modulesArraySchema.optional(),
  isActive: z.boolean().optional(),
});

// Sync schemas
export const syncPushSchema = z.object({
  layouts: z.array(
    z.object({
      id: z.string().uuid(),
      name: z.string().min(1).max(100),
      modules: modulesArraySchema,
      isActive: z.boolean(),
      version: z.number().int(),
      updatedAt: z.string().datetime(),
      deleted: z.boolean().optional(),
    })
  ),
  lastSyncedAt: z.string().datetime().optional(),
});

// Mirror schemas
export const registerMirrorSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(100),
});

// Relay command schemas
export const relayCommandSchema = z.object({
  command: z.enum(['getLayout', 'updateLayout', 'getStatus', 'displayOn', 'displayOff']),
  payload: z.record(z.string(), z.unknown()).optional(),
});

// User preferences schema
export const userPreferencesSchema = z.object({
  theme: z.enum(['light', 'dark']).optional(),
  syncEnabled: z.boolean().optional(),
  notifications: z
    .object({
      mirrorOffline: z.boolean().optional(),
      syncErrors: z.boolean().optional(),
    })
    .optional(),
});

// Type exports
export type ModuleConfig = z.infer<typeof moduleConfigSchema>;
export type CreateLayoutInput = z.infer<typeof createLayoutSchema>;
export type UpdateLayoutInput = z.infer<typeof updateLayoutSchema>;
export type SyncPushInput = z.infer<typeof syncPushSchema>;
export type RegisterMirrorInput = z.infer<typeof registerMirrorSchema>;
export type RelayCommand = z.infer<typeof relayCommandSchema>;
export type UserPreferences = z.infer<typeof userPreferencesSchema>;
