const modes = ['default', 'auto', 'acceptEdits', 'plan', 'bypassPermissions'];
export async function profilePreferences(db: D1Database, user: string, request: Request) {
  if (request.method === 'PATCH') {
    const input = await request.json().catch(() => null) as {permissionMode?:string}|null;
    if (!input || !modes.includes(input.permissionMode ?? '')) return Response.json({error:'Choose a permission level.'}, {status:400});
    await db.prepare('INSERT INTO member_preferences(user_id,permission_mode) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET permission_mode=excluded.permission_mode').bind(user,input.permissionMode).run();
  }
  const value = await db.prepare('SELECT permission_mode AS permissionMode FROM member_preferences WHERE user_id=?').bind(user).first<{permissionMode:string}>();
  return Response.json(value ?? {permissionMode:'default'});
}
