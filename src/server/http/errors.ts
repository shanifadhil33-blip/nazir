import { ZodError } from 'zod';
export class Unauthorized extends Error {
  constructor() { super('Please sign in to continue.'); this.name = 'Unauthorized'; }
}
export class Forbidden extends Error {
  constructor() { super('Your role cannot do this.'); this.name = 'Forbidden'; }
}
export class TooMany extends Error {
  constructor(message = 'You have reached the limit for now.') { super(message); this.name = 'TooMany'; }
}
export class NotFound extends Error {
  constructor() { super('The record was not found.'); this.name = 'NotFound'; }
}
export function mapError(error: unknown) {
  if (error instanceof Unauthorized) return { status: 401, body: { error: { code: 'unauthorized', message: error.message } } };
  if (error instanceof Forbidden) return { status: 403, body: { error: { code: 'forbidden', message: error.message } } };
  if (error instanceof TooMany) return { status: 429, body: { error: { code: 'too_many', message: error.message } } };
  if (error instanceof NotFound) return { status: 404, body: { error: { code: 'not_found', message: error.message } } };
  if (error instanceof ZodError) return { status: 400, body: { error: { code: 'validation', message: 'Check the details and try again.' } } };
  return { status: 500, body: { error: { code: 'internal_error', message: 'Something went wrong.' } } };
}
export function errorResponse(error: unknown): Response {
  const result = mapError(error);
  return Response.json(result.body, { status: result.status });
}
