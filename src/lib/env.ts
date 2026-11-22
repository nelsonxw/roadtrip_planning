import { z } from "zod";

const optionalString = z.preprocess((value) => (value === "" ? undefined : value), z.string().optional());

const envSchema = z.object({
  OPENROUTESERVICE_API_KEY: optionalString,
  GEOAPIFY_API_KEY: optionalString,
  WIKIMEDIA_USER_AGENT: z.preprocess((value) => value || "RoadTripAI/0.1", z.string()),
  GEMINI_API_KEY: optionalString,
  GEMINI_MODEL: z.preprocess((value) => value || "gemini-3.8-flash", z.string()),
  ANTHROPIC_API_KEY: optionalString,
  ANTHROPIC_MODEL: optionalString,
  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(30),
  FIREBASE_PROJECT_ID: optionalString,
  GOOGLE_APPLICATION_CREDENTIALS: optionalString,
  FIREBASE_SERVICE_ACCOUNT_JSON: optionalString,
});

export const env = envSchema.parse(process.env);
