import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { ZodError } from 'zod';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { authenticated, requireThat } from './security.js';
import { authRouter } from './auth-routes.js';
import { userRouter } from './user-routes.js';
import { sessionRouter } from './session-routes.js';
import { attendanceRouter } from './attendance-routes.js';
import { leaveRouter } from './leave-routes.js';
import { communicationRouter } from './communication-routes.js';

export function createApp({ origin = process.env.APP_ORIGIN || 'http://localhost:5173' } = {}) {
  const app = express();
  app.disable('x-powered-by');
  if (process.env.TRUST_PROXY === 'true') app.set('trust proxy', 1);
  app.use(helmet({ contentSecurityPolicy: { directives: { 'script-src': ["'self'"], 'style-src': ["'self'", "'unsafe-inline'"], 'img-src': ["'self'", 'data:'], 'connect-src': ["'self'"], 'upgrade-insecure-requests': process.env.NODE_ENV === 'production' ? [] : null } } }));
  app.use(express.json({ limit: '256kb' })); app.use(cookieParser());
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store'); req.requestId = randomUUID(); res.set('X-Request-Id', req.requestId);
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      requireThat(req.get('Origin') === origin, 403, 'ORIGIN_REJECTED');
      requireThat(req.is('application/json'), 415, 'JSON_REQUIRED');
    }
    next();
  });
  app.get('/api/health', (req, res) => res.json({ status: 'ok' }));
  app.use('/api/auth', authRouter);
  app.use('/api', authenticated, (req, res, next) => { requireThat(!req.user.mustChangePassword, 403, 'PASSWORD_CHANGE_REQUIRED'); next(); });
  app.use('/api', userRouter, sessionRouter, attendanceRouter, leaveRouter, communicationRouter);
  app.use('/api', (req, res) => res.status(404).json({ error: 'NOT_FOUND' }));
  const dist = fileURLToPath(new URL('../../web/dist/', import.meta.url));
  if (existsSync(dist)) {
    app.use(express.static(dist, { setHeaders: (res, path) => { if (path.endsWith('sw.js') || path.endsWith('index.html')) res.set('Cache-Control', 'no-cache'); } }));
    app.get('/{*path}', (req, res) => res.sendFile(`${dist}/index.html`));
  }
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    if (err instanceof ZodError) return res.status(422).json({ error: 'VALIDATION_FAILED', fields: err.issues.map(i => ({ path: i.path.join('.'), message: i.message })) });
    if (err.code === 11000) return res.status(409).json({ error: err.keyPattern?.username ? 'USERNAME_UNAVAILABLE' : 'CONCURRENT_CHANGE_RETRY' });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'INVALID_JSON' });
    if (err.status) return res.status(err.status).json({ error: typeof err.code === 'string' ? err.code : 'REQUEST_FAILED' });
    console.error('Request failed', req.requestId, err.name, process.env.NODE_ENV === 'test' ? err.message : '');
    res.status(500).json({ error: 'SERVER_ERROR', requestId: req.requestId });
  });
  return app;
}
