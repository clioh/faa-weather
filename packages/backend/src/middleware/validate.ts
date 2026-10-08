/**
 * Validation Middleware
 *
 * Provides request body validation using Zod schemas.
 */

import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type { ZodSchema, ZodError } from 'zod';

/**
 * Format Zod validation errors into a user-friendly response.
 */
function formatZodErrors(error: ZodError): { field: string; message: string }[] {
  return error.issues.map((issue) => ({
    field: issue.path.join('.'),
    message: issue.message,
  }));
}

/**
 * Middleware factory that validates request body against a Zod schema.
 *
 * @param schema - Zod schema to validate against
 * @returns Express middleware that validates req.body
 *
 * @example
 * router.post('/users', validateBody(createUserSchema), (req, res) => {
 *   // req.body is now typed and validated
 * });
 */
export function validateBody<T>(schema: ZodSchema<T>): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);

    if (!result.success) {
      res.status(400).json({
        error: 'Validation failed',
        details: formatZodErrors(result.error),
      });
      return;
    }

    // Replace body with parsed/transformed data
    req.body = result.data;
    next();
  };
}

/**
 * Middleware factory that validates request query parameters against a Zod schema.
 *
 * @param schema - Zod schema to validate against
 * @returns Express middleware that validates req.query
 */
export function validateQuery<T>(schema: ZodSchema<T>): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.query);

    if (!result.success) {
      res.status(400).json({
        error: 'Invalid query parameters',
        details: formatZodErrors(result.error),
      });
      return;
    }

    // Replace query with parsed/transformed data
    (req as Request & { query: T }).query = result.data as T & typeof req.query;
    next();
  };
}

/**
 * Middleware factory that validates request params against a Zod schema.
 *
 * @param schema - Zod schema to validate against
 * @returns Express middleware that validates req.params
 */
export function validateParams<T>(schema: ZodSchema<T>): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.params);

    if (!result.success) {
      res.status(400).json({
        error: 'Invalid path parameters',
        details: formatZodErrors(result.error),
      });
      return;
    }

    // Replace params with parsed/transformed data
    req.params = result.data as T & typeof req.params;
    next();
  };
}

export default {
  validateBody,
  validateQuery,
  validateParams,
};
