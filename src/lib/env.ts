import { z } from "zod";

const optionalString = z.preprocess((value) => (value === "" ? undefined : value), z.string().optional());

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  OPENROUTESERVICE_API_KEY: optionalString,
  GEOAPIFY_API_KEY: optionalString,
  WIKIMEDIA_USER_AGENT: z.preprocess((value) => value || "RoadTripAI/0.1", z.string()),
  GEMINI_API_KEY: optionalString,
  GEMINI_MODEL: z.preprocess((value) => value || "gemini-3.8-flash", z.string()),
  ANTHROPIC_API_KEY: optionalString,
  ANTHROPIC_MODEL: optionalString,
  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(30),
});

export const env = envSchema.parse(process.env);
