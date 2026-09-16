import { Agent as HttpAgent, type IncomingMessage, type ServerResponse } from 'node:http';
import { Agent as HttpsAgent } from 'node:https';
import type { Plugin, ProxyOptions } from 'vite';

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
  const call = async (path: string, body: unknown) => {
    const response = await fetch(new URL(path, hub), {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify(body)});
    const result = await response.json();
    if (!response.ok && response.status !== 429) throw Error('Could not sign in; try again.');
    return result;
  };
  const accept = (result: {accessToken: string; refreshToken?: string; expiresIn: number}) => {
    token = result.accessToken;
    refreshToken = result.refreshToken ?? '';
    expiresAt = Date.now() + result.expiresIn * 1000;
  };
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
      server.httpServer?.once('close', () => agent.destroy());
      server.middlewares.use(async (request, response, next) => {
        if (!request.url?.startsWith('/api/')) return next();
        if (!trusted(request)) return json(response, 403, {error:'Open the preview on this Mac.'});
        try {
          if (request.url === '/api/runtime') return json(response, 200, {mode:'hub', preview:true, auth:{magicLink:false,google:false,github:false,sso:false}});
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
          if (Date.now() > expiresAt - 60000) {
            refreshing ??= call('/api/sessions/refresh', {refreshToken}).then(accept).catch(() => { token=''; refreshToken=''; }).finally(() => {refreshing=undefined;});
            await refreshing;
            if (!token) return json(response, 401, {error:'Sign in again.'});
          }
          next();
        } catch { json(response, 502, {error:'Could not connect to Remy; try again.'}); }
      });
    },
  };
  return {plugin, proxy:{target:hub.origin,changeOrigin:true,ws:true,agent,configure(proxy) {
    proxy.on('error', (_error, _request, response) => {
      if ('writeHead' in response && !response.headersSent && !response.writableEnded) json(response,502,{error:'Could not connect to Remy; try again.'});
    });
    proxy.on('proxyReq', (outgoing, incoming) => {
      outgoing.removeHeader('cookie');
      outgoing.setHeader('authorization',`Bearer ${token}`);
      if (incoming.url === '/api/sessions/current' && incoming.method === 'DELETE') {token=''; refreshToken='';}
    });
    proxy.on('proxyReqWs', (outgoing, incoming) => {
      if (!trusted(incoming) || !token) { outgoing.destroy(); return; }
      outgoing.removeHeader('cookie');
      outgoing.setHeader('authorization',`Bearer ${token}`);
    });
  }}};
}
