import { z } from 'zod';

const loopbackHosts = new Set(['127.0.0.1', '::1', '[::1]', 'localhost']);

export function isLoopbackHost(host) {
  return loopbackHosts.has(host);
}

const publicOriginSchema = z.string().trim().refine((value) => {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && url.origin === value;
  } catch {
    return false;
  }
}, 'Use an exact origin such as https://example.com, without a trailing slash.');

const envSchema = z.object({
  HOST: z.string().trim().min(1).default('127.0.0.1'),
  PORT: z.string().regex(/^[0-9]+$/).default('3001')
    .transform(Number).pipe(z.number().int().min(1).max(65535)),
  PUBLIC_DEMO: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  PUBLIC_ORIGIN: publicOriginSchema.optional(),
  GEMINI_API_KEY: z.string().trim().optional(),
  GEMINI_MODEL: z.string().trim().regex(/^gemini-[a-z0-9.-]+$/).optional(),
  MONGODB_URI: z.string().trim().default('').refine(
    (uri) => uri === '' || /^mongodb(?:\+srv)?:\/\/\S+$/.test(uri),
    'Use a MongoDB connection URI or leave this field empty.',
  ),
}).superRefine((env, context) => {
  if (!env.PUBLIC_DEMO && !['127.0.0.1', '::1'].includes(env.HOST)) {
    context.addIssue({ code: 'custom', path: ['HOST'], message: 'Use a loopback bind for editable mode or enable PUBLIC_DEMO.' });
  }
  if (!env.PUBLIC_DEMO && env.PUBLIC_ORIGIN) {
    context.addIssue({ code: 'custom', path: ['PUBLIC_ORIGIN'], message: 'Use PUBLIC_ORIGIN only with PUBLIC_DEMO.' });
  }
});

export function readEnv(env) {
  return envSchema.parse(env);
}
