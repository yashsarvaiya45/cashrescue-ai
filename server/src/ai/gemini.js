import { GoogleGenAI } from '@google/genai';
import { LedgerError } from '../ledger/errors.js';

export const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash';

export function createGeminiProvider({ apiKey, model = DEFAULT_GEMINI_MODEL }) {
  if (!apiKey) return null;
  const client = new GoogleGenAI({
    apiKey, vertexai: false,
    httpOptions: {
      baseUrl: 'https://generativelanguage.googleapis.com',
      timeout: 35_000,
      retryOptions: { attempts: 1 },
    },
  });

  return {
    model,
    async generate({ instruction, parts, jsonSchema }) {
      const signal = AbortSignal.timeout(35_000);
      try {
        const response = await client.models.generateContent({
          model, contents: [{ role: 'user', parts }],
          config: {
            systemInstruction: instruction, responseMimeType: 'application/json',
            responseJsonSchema: jsonSchema, maxOutputTokens: 1500, abortSignal: signal,
            ...(model === 'gemini-3.8-flash' && { thinkingConfig: { thinkingLevel: 'LOW' } }),
          },
        });
        return response.text;
      } catch (error) {
        const status = Number(error.status);
        if (status === 429) throw new LedgerError(503, 'AI_QUOTA', 'Gemini quota is temporarily unavailable.');
        if (status === 401 || status === 403) throw new LedgerError(503, 'AI_ACCESS', 'Gemini denied access for this project.');
        if (status === 404) throw new LedgerError(503, 'AI_MODEL', 'The configured Gemini model is unavailable.');
        if (signal.aborted || status === 504 || error.name === 'TimeoutError') {
          throw new LedgerError(504, 'AI_TIMEOUT', 'Gemini took too long to respond.');
        }
        if (status === 503) throw new LedgerError(503, 'AI_BUSY', 'Gemini is temporarily unavailable. Try again shortly.');
        throw new LedgerError(502, 'AI_PROVIDER', 'Gemini could not process this request.');
      }
    },
  };
}
