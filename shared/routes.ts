import { z } from 'zod';
import { 
  insertSlateSchema, 
  slates, 
  insertPlayerSchema, 
  players, 
  insertLineupSchema, 
  lineups, 
  optimizationConstraintSchema,
  optimizeResponseSchema
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
