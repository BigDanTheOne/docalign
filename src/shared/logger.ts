import pino, { type Logger, type DestinationStream } from 'pino';

const REDACT_PATHS = [
  'token',
  'apiKey',
  'github_private_key',
  'password',
  'secret',
  'req.headers.authorization',
];

export function createRootLogger(destination?: DestinationStream): Logger {
  return pino(
    {
      level: process.env.LOG_LEVEL || 'info',
      redact: {
        paths: REDACT_PATHS,
        censor: '[REDACTED]',
      },
      formatters: {
        level(label) {
          return { level: label };
        },
      },
    },
    destination as DestinationStream,
  );
}

const logger = createRootLogger();

export function createLogger(context: Record<string, unknown>): Logger {
  return logger.child(context);
}

export default logger;
