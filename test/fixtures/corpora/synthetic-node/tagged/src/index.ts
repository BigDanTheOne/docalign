import express from 'express';
import pinoHttp from 'pino-http';
import rateLimit from 'express-rate-limit';
import { config } from './config';
import { authMiddleware } from './middleware/auth';
import { errorHandler } from './middleware/errorHandler';
import { userRoutes } from './routes/users';
import { taskRoutes } from './routes/tasks';
import { NotificationService } from './services/NotificationService';

NotificationService.init();

const app = express();

// Content-type parsing — required for JSON request bodies
app.use(express.json());

// Structured request logging — first middleware in the pipeline
app.use(pinoHttp());

// Rate limiting applied globally
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: config.RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    code: 'RATE_LIMIT_EXCEEDED',
    message: 'Too many requests. Please try again later.',
  },
}));

// Health check — unauthenticated, before auth middleware
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', version: '2.1.0' });
});

// Auth middleware scoped to protected routes under /api/v1
app.use('/api/v1', authMiddleware, (_req, _res, next) => {
  next();
});

// Route mounts — routes use absolute paths, so mount at root
app.use(userRoutes);
app.use(taskRoutes);

// Error handler — must be registered last to catch all unhandled errors
app.use(errorHandler);

const PORT = config.PORT;

app.listen(PORT, () => {
  console.log(`Taskflow API listening on port ${PORT}`);
});

export { app };
