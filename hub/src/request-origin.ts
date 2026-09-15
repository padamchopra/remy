/// Preview clients use an explicitly approved origin and their own bearer session.
export function allowedRequestOrigin(request: Request, previewOrigins?: string): boolean {
  const origin = request.headers.get("origin");
  if (!origin || origin === new URL(request.url).origin) return true;
  return !!request.headers.get("authorization")?.startsWith("Bearer ")
    && (previewOrigins ?? "").split(",").map((value) => value.trim()).includes(origin);
}
