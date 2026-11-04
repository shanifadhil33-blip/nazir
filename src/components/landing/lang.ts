import type { Lang } from '@/components/ocean/copy';

export function langOf(value?: string): Lang {
  return value === 'ar' ? 'ar' : 'en';
}
