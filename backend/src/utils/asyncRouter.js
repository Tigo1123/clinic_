import express from 'express';

const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'all', 'use'];

function wrap(handler) {
  if (Array.isArray(handler)) return handler.map(wrap);
  // Skip non-functions, error handlers (4 args), and mounted Routers
  if (typeof handler !== 'function' || handler.length === 4 || typeof handler.handle === 'function') {
    return handler;
  }
  return function asyncWrapped(req, res, next) {
    return Promise.resolve(handler(req, res, next)).catch(next);
  };
}

export function asyncRouter(options) {
  const router = express.Router(options);
  for (const method of METHODS) {
    const original = router[method].bind(router);
    router[method] = (...args) => original(...args.map(wrap));
  }
  return router;
}
