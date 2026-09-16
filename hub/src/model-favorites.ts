export async function modelFavorites(db: D1Database, organizationId: string, userId: string, request: Request): Promise<Response> {
  if (request.method === "PATCH") {
    const input = await request.json().catch(() => null) as { key?: unknown; enabled?: unknown } | null;
    if (!input || typeof input.key !== "string" || !input.key.includes(":") || input.key.length > 1024 || typeof input.enabled !== "boolean") {
      return Response.json({ error: "Choose a model to favorite." }, { status: 400 });
    }
    await db.prepare(input.enabled
      ? "INSERT OR IGNORE INTO member_model_favorites(organization_id,user_id,model_key) VALUES(?,?,?)"
      : "DELETE FROM member_model_favorites WHERE organization_id=? AND user_id=? AND model_key=?"
    ).bind(organizationId, userId, input.key).run();
  }
  const rows = await db.prepare("SELECT model_key FROM member_model_favorites WHERE organization_id=? AND user_id=? ORDER BY rowid").bind(organizationId, userId).all<{ model_key: string }>();
  return Response.json({ favorites: rows.results.map(row => row.model_key) }, { headers: { "cache-control": "no-store" } });
}
