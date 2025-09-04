import pino from 'pino';

// Pretty-prints logs to console in development; structured JSON in production
const logger = pino({
	level: process.env.LOG_LEVEL || 'info',
	transport:
		process.env.NODE_ENV === 'development'
			? { target: 'pino-pretty', options: { colorize: true } } // human-readable in dev
			: undefined,
});

export default logger;
