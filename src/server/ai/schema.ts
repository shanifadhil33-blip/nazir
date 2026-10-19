export type Tool = { type: string; function: { name: string; parameters: Record<string, unknown> } };
type Schema = Record<string, unknown>;
export function matchesSchema(value: unknown, schema: Schema): boolean {
  if (Array.isArray(schema.anyOf) && !schema.anyOf.some((item) => matchesSchema(value, item))) return false;
  if (Array.isArray(schema.enum) && !schema.enum.some((item) => item === value)) return false;
  switch (schema.type) {
    case 'null': return value === null;
    case 'boolean': return typeof value === 'boolean';
    case 'integer': return typeof value === 'number' && Number.isSafeInteger(value);
    case 'number': return typeof value === 'number' && Number.isFinite(value);
    case 'string':
      return typeof value === 'string' &&
        (typeof schema.minLength !== 'number' || [...value].length >= schema.minLength) &&
        (typeof schema.maxLength !== 'number' || [...value].length <= schema.maxLength) &&
        (typeof schema.pattern !== 'string' || new RegExp(schema.pattern).test(value));
    case 'object': {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
      const object = value as Record<string, unknown>;
      const properties = (schema.properties ?? {}) as Record<string, Schema>;
      if (Array.isArray(schema.required) && schema.required.some((key) => !Object.hasOwn(object, key))) return false;
      return Object.entries(object).every(([key, item]) => Object.hasOwn(properties, key) ? matchesSchema(item, properties[key]!) : schema.additionalProperties !== false);
    }
    default: return schema.type === undefined;
  }
}
