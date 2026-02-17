import rateLimit from 'express-rate-limit';

const maxRequests = parseInt(process.env.RATE_LIMIT_MAX ?? '100', 10);

export const rateLimitMiddleware = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    code: 'RATE_LIMIT_EXCEEDED',
    message: `Too many requests. Limit: ${maxRequests} per 15 minutes per IP.`,
  },
  keyGenerator: (req) => {
    return req.ip ?? req.socket.remoteAddress ?? 'unknown';
  },
});
