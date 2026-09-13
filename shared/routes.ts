import { z } from 'zod';
import { 
  insertSlateSchema, 
  slates, 
  insertPlayerSchema, 
  players, 
  insertLineupSchema, 
  lineups, 
  optimizationConstraintSchema,
  optimizeResponseSchema,
} from './schema';

export const errorSchemas = {
  validation: z.object({
    message: z.string(),
    field: z.string().optional(),
  }),
  notFound: z.object({
    message: z.string(),
  }),
  internal: z.object({
    message: z.string(),
  }),
};

export const api = {
  exports: {
    resolvePlayers: {
      method: 'POST' as const,
      path: '/api/exports/resolve-players' as const,
      input: z.object({
        slateId: z.number().int().positive(),
        playerIds: z.array(z.number().int().positive()).min(1),
        captainId: z.number().int().positive().optional(),
      }),
      responses: {
        200: z.object({
          slate: z.object({
            id: z.number(),
            sport: z.string(),
            platform: z.string(),
            draftGroupId: z.number().nullable(),
            gameType: z.string(),
            label: z.string(),
            name: z.string(),
          }),
          players: z.array(z.custom<typeof players.$inferSelect>()),
        }),
        400: errorSchemas.validation,
        401: z.object({ message: z.string() }),
        404: errorSchemas.notFound,
        503: errorSchemas.internal,
      },
    },
  },
  slates: {
    list: {
      method: 'GET' as const,
      path: '/api/slates' as const,
      responses: {
        200: z.array(z.custom<typeof slates.$inferSelect>()),
      },
    },
    create: {
      method: 'POST' as const,
      path: '/api/slates' as const,
      input: insertSlateSchema,
      responses: {
        201: z.custom<typeof slates.$inferSelect>(),
        400: errorSchemas.validation,
      },
    },
    getPlayers: {
      method: 'GET' as const,
      path: '/api/slates/:id/players' as const,
      responses: {
        200: z.array(z.custom<typeof players.$inferSelect>()),
        404: errorSchemas.notFound,
      },
    },
    favoriteStacks: {
      list: {
        method: 'GET' as const,
        path: '/api/slates/:slateId/favorite-stacks' as const,
        responses: {
          200: z.array(z.object({
            id: z.number(),
            slateId: z.number(),
            kind: z.enum(["game", "players"]),
            name: z.string(),
            gameKey: z.string().nullable(),
            playerIds: z.array(z.number()),
          })),
        },
      },
      create: {
        method: 'POST' as const,
        path: '/api/slates/:slateId/favorite-stacks' as const,
        input: z.object({
          kind: z.enum(["game", "players"]),
          name: z.string().min(1),
          gameKey: z.string().nullable().optional(),
          playerIds: z.array(z.number().int().positive()).optional(),
        }),
        responses: {
          201: z.object({
            id: z.number(),
            slateId: z.number(),
            kind: z.enum(["game", "players"]),
            name: z.string(),
            gameKey: z.string().nullable(),
            playerIds: z.array(z.number()),
          }),
          400: errorSchemas.validation,
          401: z.object({ message: z.string() }),
          404: errorSchemas.notFound,
        },
      },
      delete: {
        method: 'DELETE' as const,
        path: '/api/slates/:slateId/favorite-stacks/:id' as const,
        responses: {
          204: z.void(),
          401: z.object({ message: z.string() }),
          404: errorSchemas.notFound,
        },
      },
    },
  },
  players: {
     bulkCreate: {
      method: 'POST' as const,
      path: '/api/slates/:id/players/bulk' as const,
      input: z.array(insertPlayerSchema),
      responses: {
        201: z.array(z.custom<typeof players.$inferSelect>()),
        400: errorSchemas.validation,
      },
    }
  },
  optimizer: {
    optimize: {
      method: 'POST' as const,
      path: '/api/optimize' as const,
      input: optimizationConstraintSchema,
      responses: {
        200: optimizeResponseSchema,
        400: errorSchemas.validation,
        500: errorSchemas.internal,
      },
    },
  },
  lineups: {
    list: {
      method: 'GET' as const,
      path: '/api/lineups' as const,
      responses: {
        200: z.array(z.custom<typeof lineups.$inferSelect>()),
      },
    },
    create: {
      method: 'POST' as const,
      path: '/api/lineups' as const,
      input: insertLineupSchema,
      responses: {
        201: z.custom<typeof lineups.$inferSelect>(),
        400: errorSchemas.validation,
      },
    },
    delete: {
      method: 'DELETE' as const,
      path: '/api/lineups/:id' as const,
      responses: {
        204: z.void(),
        404: errorSchemas.notFound,
      },
    },
  },
};

export function buildUrl(path: string, params?: Record<string, string | number>): string {
  let url = path;
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (url.includes(`:${key}`)) {
        url = url.replace(`:${key}`, String(value));
      }
    });
  }
  return url;
}
