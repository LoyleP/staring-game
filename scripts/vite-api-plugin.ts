import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';

/**
 * Exécute les fonctions de api/ dans le serveur de développement Vite (rechargement à chaud inclus),
 * avec l'API req/res de Vercel Functions. En local, le store est en mémoire (voir api/_lib/store.ts).
 */
export function apiDevPlugin(): Plugin {
  return {
    name: 'aura-api-dev',
    configureServer(server) {
      // WebSocket de signalisation : même module que sur Vercel, branché sur l'événement Upgrade de Vite.
      server.httpServer?.on('upgrade', async (req: IncomingMessage, socket, head) => {
        if (!req.url?.startsWith('/api/signal')) return; // le HMR de Vite gère les autres
        try {
          const mod = await server.ssrLoadModule('/api/signal.ts');
          mod.upgrade(req, socket, head);
        } catch (e) {
          server.config.logger.error(`[api/signal] ${(e as Error).stack ?? e}`);
          socket.destroy();
        }
      });

      server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next) => {
        if (!req.url?.startsWith('/api/')) return next();
        const url = new URL(req.url, 'http://localhost');
        const name = url.pathname.slice('/api/'.length);
        if (!/^[a-z-]+$/.test(name)) return next();

        const send = (status: number, body: unknown) => {
          res.statusCode = status;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify(body));
        };

        try {
          const mod = await server.ssrLoadModule(`/api/${name}.ts`);
          if (typeof mod.default !== 'function') return send(404, { error: 'not-found' });

          const chunks: Buffer[] = [];
          for await (const c of req) chunks.push(c as Buffer);
          const raw = Buffer.concat(chunks).toString('utf8');
          let body: unknown = undefined;
          if (raw) {
            try {
              body = JSON.parse(raw);
            } catch {
              body = raw;
            }
          }

          const vReq = Object.assign(req, { query: Object.fromEntries(url.searchParams), body });
          const vRes = Object.assign(res, {
            status(code: number) {
              res.statusCode = code;
              return vRes;
            },
            json(data: unknown) {
              res.setHeader('content-type', 'application/json');
              res.end(JSON.stringify(data));
              return vRes;
            },
          });
          await mod.default(vReq, vRes);
        } catch (e) {
          server.config.logger.error(`[api/${name}] ${(e as Error).stack ?? e}`);
          if (!res.headersSent) send(500, { error: 'server', message: (e as Error).message });
        }
      });
    },
  };
}
