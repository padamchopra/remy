export const QA_ACCOUNT_ERROR = 'set REMY_QA_EMAIL and REMY_QA_PASSWORD';

export function qaHostedAccount(env = process.env) {
  const email = env.REMY_QA_EMAIL?.trim() ?? '';
  const password = env.REMY_QA_PASSWORD ?? '';
  if (!email || !password) throw new Error(QA_ACCOUNT_ERROR);
  return { email, password };
}

export function qaHostedAccountAvailable(env = process.env) {
  try {
    qaHostedAccount(env);
    return true;
  } catch {
    return false;
  }
}

function cookiePairs(response) {
  return (typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [])
    .map((cookie) => cookie.split(';')[0] ?? '')
    .filter(Boolean);
}

function cookieValue(cookies, name) {
  const prefix = `${name}=`;
  const pair = cookies.find((cookie) => cookie.startsWith(prefix));
  return pair ? decodeURIComponent(pair.slice(prefix.length)) : undefined;
}

/// Sign in through production email/password, then exchange that Better Auth
/// session for a Remy web session. The password never belongs in a thrown
/// message or returned payload.
export async function signInWithPassword(input) {
  const request = input.fetch ?? fetch;
  const origin = new URL(input.hub).origin;
  const signIn = await request(new URL('/api/auth/sign-in/email', origin), {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify({ email: input.email, password: input.password }),
  });
  if (!signIn.ok) throw new Error('Could not sign in; try again.');
  const session = await request(new URL('/api/sessions/web', origin), {
    method: 'POST',
    headers: {
      cookie: cookiePairs(signIn).join('; '),
      origin,
      'user-agent': input.userAgent ?? 'Remy local web preview',
    },
  });
  if (!session.ok) throw new Error('Could not sign in; try again.');
  const body = await session.json();
  const accessToken = cookieValue(cookiePairs(session), 'remy_session');
  if (!accessToken || typeof body.expiresIn !== 'number') throw new Error('Could not sign in; try again.');
  return { accessToken, expiresIn: body.expiresIn };
}
