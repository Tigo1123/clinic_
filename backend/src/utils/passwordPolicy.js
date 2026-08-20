import { z } from 'zod';

export const passwordSchema = z
  .string()
  .min(10, 'Password must contain at least 10 characters.')
  .max(200, 'Password must contain at most 200 characters.')
  .regex(/[A-Z]/, 'Password requires an uppercase letter.')
  .regex(/[a-z]/, 'Password requires a lowercase letter.')
  .regex(/\d/, 'Password requires a number.');
