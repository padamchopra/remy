import { Agent as HttpAgent, type IncomingMessage, type ServerResponse } from 'node:http';
import { Agent as HttpsAgent } from 'node:https';
import type { Plugin, ProxyOptions } from 'vite';
import { QA_ACCOUNT_ERROR, qaHostedAccount, qaHostedAccountAvailable, signInWithPassword } from './hosted-account.mjs';

/// How long before an access token expires the preview replaces it.
const REFRESH_MARGIN_MS = 60_000;
const REFRESH_RETRY_MS = 2_000;
const REFRESH_RETRY_MAX_MS = 60_000;
/// A tab closing or reloading ends its socket mid-write. That is not a proxy
/// fault worth a stack trace on every reconnect.
const DISCONNECTS = new Set(['EPIPE', 'ECONNRESET', 'ECONNABORTED']);

export function hostedPreview(target: string): { plugin: Plugin; proxy: ProxyOptions } {
  const hub = new URL(target);
  if (hub.protocol !== 'https:' && !['127.0.0.1', 'localhost'].includes(hub.hostname)) throw Error('Use HTTPS for the hosted service.');
  const agent = new (hub.protocol === 'https:' ? HttpsAgent : HttpAgent)({keepAlive:true, autoSelectFamilyAttemptTimeout:2000});
  let origin = '';
  let token = '';
  let refreshToken = '';
  let expiresAt = 0;
  let deviceCode = '';
  let refreshing: Promise<void> | undefined;
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  let retryDelay = REFRESH_RETRY_MS;
  const call = async (path: string, body: unknown) => {
    const response = await fetch(new URL(path, hub), {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify(body)});
    const result = await response.json();
    if (!response.ok && response.status !== 429) throw Error('Could not sign in; try again.');
    return result;
  };
  const forget = () => {
    token = ''; refreshToken = ''; expiresAt = 0;
    clearTimeout(refreshTimer);
  };
  const due = () => !!token && !!refreshToken && Date.now() > expiresAt - REFRESH_MARGIN_MS;
  const later = (delay: number) => {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => void refresh(), Math.max(0, delay));
    refreshTimer.unref();
  };
  const accept = (result: {accessToken?: unknown; refreshToken?: unknown; expiresIn?: unknown}) => {
    if (typeof result.accessToken !== 'string' || !result.accessToken || typeof result.expiresIn !== 'number') throw Error('Could not sign in; try again.');
    token = result.accessToken;
    refreshToken = typeof result.refreshToken === 'string' ? result.refreshToken : '';
    expiresAt = Date.now() + result.expiresIn * 1000;
    retryDelay = REFRESH_RETRY_MS;
    // Refresh ahead of expiry rather than on the next request. A page that is
    // only listening on live sockets sends none, and the hub closes those
    // sockets with "Sign in again." once the session's access has lapsed.
    if (refreshToken) later(expiresAt - REFRESH_MARGIN_MS - Date.now());
    else clearTimeout(refreshTimer);
  };
  /// Only a hub that rejects the refresh token ends the session. A network
  /// failure or a hub error keeps it and tries again, backing off.
  const refresh = (): Promise<void> => refreshing ??= (async () => {
    const sent = refreshToken;
    if (!sent) return;
    let response: Response;
    try {
      response = await fetch(new URL('/api/sessions/refresh', hub), {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({refreshToken:sent})});
    } catch {
      response = new Response(null, {status:503});
    }
    if (sent !== refreshToken) return;
    if (response.status === 401 || response.status === 403) { forget(); return; }
    try {
      if (!response.ok) throw Error(String(response.status));
      accept(await response.json());
    } catch {
      later(retryDelay);
      retryDelay = Math.min(retryDelay * 2, REFRESH_RETRY_MAX_MS);
    }
  })().finally(() => { refreshing = undefined; });
  const trusted = (request: IncomingMessage) => request.headers.host === new URL(origin).host
    && (!request.headers.origin || request.headers.origin === origin)
    && request.headers['sec-fetch-site'] !== 'cross-site';
  const json = (response: ServerResponse, status: number, body: unknown) => {
    response.writeHead(status, {'content-type':'application/json','cache-control':'no-store'});
    response.end(JSON.stringify(body));
  };
  const plugin: Plugin = {
    name:'hosted-preview',
    configureServer(server) {
      origin = `http://127.0.0.1:${server.config.server.port}`;
      const httpServer = server.httpServer;
      httpServer?.once('close', () => { agent.destroy(); clearTimeout(refreshTimer); });
      // A websocket upgrade never passes through the middleware below, so a
      // reconnect after a sleep would carry an expired token. Hold a due
      // upgrade until the refresh settles, then hand it to Vite's proxy.
      if (httpServer) {
        const emit = httpServer.emit.bind(httpServer) as (event: string, ...args: unknown[]) => boolean;
        httpServer.emit = ((event: string, ...args: unknown[]) => {
          if (event !== 'upgrade' || !due()) return emit(event, ...args);
          void refresh().finally(() => emit(event, ...args));
          return true;
        }) as typeof httpServer.emit;
      }
      server.middlewares.use(async (request, response, next) => {
        // The backend allows only the 127.0.0.1 origin, so a page opened on
        // `localhost` would load but fail every request. Send it to the one
        // address that works rather than widening the allowlist.
        const host = request.headers.host ?? '';
        if (!request.url?.startsWith('/api/') && /^(localhost|\[::1\])(:\d+)?$/.test(host)) {
          response.writeHead(307, {location:`${origin}${request.url ?? '/'}`});
          return response.end();
        }
        if (!request.url?.startsWith('/api/')) return next();
        if (!trusted(request)) return json(response, 403, {error:`Open the preview at ${origin}.`});
        try {
          if (request.url === '/api/runtime') return json(response, 200, {mode:'hub', preview:true, auth:{magicLink:false,google:false,github:false,sso:false,password:qaHostedAccountAvailable()}});
          if (request.url === '/api/preview/password' && request.method === 'POST') {
            try {
              const account = qaHostedAccount();
              accept(await signInWithPassword({hub:hub.origin, email:account.email, password:account.password, userAgent:'Remy local web preview'}));
              deviceCode = '';
              return json(response, 200, {status:'approved'});
            } catch (error) {
              if (error instanceof Error && error.message === QA_ACCOUNT_ERROR) return json(response, 400, {error:QA_ACCOUNT_ERROR});
              if (error instanceof Error && error.message === 'Could not sign in; try again.') return json(response, 401, {error:error.message});
              throw error;
            }
          }
          if (request.url === '/api/preview/sign-in' && request.method === 'POST') {
            const result = await call('/api/device/authorization', {clientKind:'cli',clientName:'Remy local web preview'});
            deviceCode = result.deviceCode;
            return json(response, 200, {userCode:result.userCode, approvalUrl:new URL(`/?preview=1&computerCode=${encodeURIComponent(result.userCode)}`,hub).href});
          }
          if (request.url === '/api/preview/complete' && request.method === 'POST') {
            if (!deviceCode) return json(response, 400, {error:'Start signing in again.'});
            const result = await call('/api/device/token', {deviceCode});
            if (result.status === 'approved') { accept(result); deviceCode = ''; }
            return json(response, 200, {status:result.status});
          }
          if (!token) return json(response, 401, {error:'Sign in to continue.'});
          if (due()) await refresh();
          if (!token) return json(response, 401, {error:'Sign in again.'});
          if (Date.now() >= expiresAt) {
            // Still refreshable: the hub was unreachable, not the session gone.
            if (refreshToken) return json(response, 502, {error:'Could not connect to Remy; try again.'});
            forget();
            return json(response, 401, {error:'Sign in again.'});
          }
          next();
        } catch { json(response, 502, {error:'Could not connect to Remy; try again.'}); }
      });
    },
  };
  return {plugin, proxy:{target:hub.origin,changeOrigin:true,ws:true,agent,configure(proxy) {
    // Vite logs every proxy error with its stack. Close a socket the browser
    // already dropped before that listener sees it; anything else still logs.
    const emit = proxy.emit.bind(proxy) as (event: string, ...args: unknown[]) => boolean;
    proxy.emit = ((event: string, ...args: unknown[]) => {
      const [error, , socket] = args as [NodeJS.ErrnoException | undefined, unknown, {destroy?: () => void} | undefined];
      if (event === 'error' && error?.code && DISCONNECTS.has(error.code) && socket && !('req' in socket)) { socket.destroy?.(); return true; }
      return emit(event, ...args);
    }) as typeof proxy.emit;
    proxy.on('error', (_error, _request, response) => {
      if ('writeHead' in response && !response.headersSent && !response.writableEnded) json(response,502,{error:'Could not connect to Remy; try again.'});
    });
    proxy.on('proxyReq', (outgoing, incoming) => {
      outgoing.removeHeader('cookie');
      outgoing.setHeader('authorization',`Bearer ${token}`);
      if (incoming.url === '/api/sessions/current' && incoming.method === 'DELETE') forget();
    });
    proxy.on('proxyReqWs', (outgoing, incoming) => {
      if (!trusted(incoming) || !token || Date.now() >= expiresAt) { outgoing.destroy(); return; }
      outgoing.removeHeader('cookie');
      outgoing.setHeader('authorization',`Bearer ${token}`);
    });
  }}};
}
