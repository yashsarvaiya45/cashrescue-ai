import { z } from 'zod';

export const paiseSchema = z.number().int()
  .min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER)
  .transform((value) => value === 0 ? 0 : value);
export const positivePaiseSchema = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);

export function addPaise(left, right) {
  const total = left + right;
  if (!Number.isSafeInteger(total)) {
    throw new RangeError('Cash-flow total exceeds the safe integer paise range.');
  }
  return total;
}
