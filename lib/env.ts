export function envOptional(name: string): string | undefined {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    return undefined;
  }
  return value;
}

export function envRequired(name: string): string {
  const value = envOptional(name);
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function numberFromEnv(name: string, fallback: number): number {
  const raw = envOptional(name);
  if (!raw) {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Environment variable ${name} must be numeric.`);
  }
  return parsed;
}

export function defaultChromaCollection(): string {
  return envOptional("CHROMA_COLLECTION") ?? "lcap_narrative_chunks";
}

export function assertApiKey(request: Request): Response | null {
  const configured = envOptional("DEMO_API_KEY");
  if (!configured) {
    return null;
  }

  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const header = request.headers.get("x-api-key");
  if (bearer === configured || header === configured) {
    return null;
  }

  return Response.json(
    { error: "Unauthorized. Provide DEMO_API_KEY as a Bearer token or x-api-key header." },
    { status: 401 }
  );
}

