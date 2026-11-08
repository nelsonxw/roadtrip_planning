// Loads local settings for the database URL, then removes provider keys so tests never call live APIs.
// Tests that exercise a live provider pass their own stubbed adapters explicitly.
process.loadEnvFile(".env.local");
delete process.env.GEMINI_API_KEY;
delete process.env.OPENROUTESERVICE_API_KEY;
delete process.env.ANTHROPIC_API_KEY;
