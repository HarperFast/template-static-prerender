export type JobConfig = {
	id: string;
	url: string;
	priority: number;
	headers?: Record<string, string>;
	maxRetries?: number;
	deviceType?: 'desktop' | 'mobile' | 'tablet';
	acceptLanguage?: string;
};

type RenderAttempt = {
	renderStartTime: number;
	renderEndTime?: number;
	error?: Error;
	content?: string;
};

type OriginHttpResponse = {
	statusCode: number;
	headers: Record<string, string>;
};

const allowedResponseHeaders = [
	'etag', // helps 304 Not Modified
	'last-modified', // helps 304 Not Modified
	'link', // canonical / hreflang if set via headers
	'x-robots-tag', // noindex/nofollow etc. via headers
	'retry-after', // for 503 responses
];

export default class RenderJob {
	// Default maximum attempts used when `maxRetries` is not provided.
	static MAX_ATTEMPTS = 3;

	// Unique job id.
	id: string;

	// Absolute URL to render.
	url: string;

	// Scheduling priority; semantics are defined by the scheduler.
	priority: number;

	// Maximum number of render attempts allowed for this job.
	maxAttempts: number;

	// Optional request headers to send to origin.
	headers?: Record<string, string>;

	// Device type to emulate (if any).
	deviceType?: 'desktop' | 'mobile' | 'tablet';

	// Accept-Language header value to use (if any).
	acceptLanguage?: string;

	// URL to redirect the job result to (if any).
	redirectTo?: string;

	// HTTP status code to use for the redirect (if any).
	redirectStatus?: number;

	// Origin HTTP response info (if any).
	_httpResponse?: OriginHttpResponse;

	// All attempts in order (first → latest).
	attempts: RenderAttempt[] = [];

	// Convenience pointer to the most recent attempt (if any).
	latestAttempt: RenderAttempt | null = null;

	constructor(config: JobConfig) {
		this.id = config.id;
		this.url = config.url;
		this.headers = config.headers;
		this.maxAttempts = config.maxRetries || RenderJob.MAX_ATTEMPTS;
		this.priority = config.priority;
		this.deviceType = config.deviceType;
		this.acceptLanguage = config.acceptLanguage;
	}

	sanitizeHeaders(headers: Record<string, string>) {
		const sanitized: Record<string, string> = {};
		for (const header of allowedResponseHeaders) {
			if (headers[header]) {
				sanitized[header] = headers[header];
			}
		}
		return sanitized;
	}

	set httpResponse(response: OriginHttpResponse) {
		const { statusCode, headers } = response;
		this._httpResponse = { statusCode, headers: this.sanitizeHeaders(headers) };
	}

	get httpResponse(): OriginHttpResponse | undefined {
		return this._httpResponse;
	}

	attemptStarted() {
		this.latestAttempt = { renderStartTime: Date.now() };
		this.attempts.push(this.latestAttempt);
		return this.latestAttempt;
	}

	attemptEnded(error?: Error, content?: string) {
		const attempt = this.latestAttempt!;
		attempt.renderEndTime = Date.now();
		attempt.error = error;
		attempt.content = content;
	}

	get content(): string | null {
		return this.latestAttempt?.content || null;
	}

	get error(): Error | null {
		return this.latestAttempt?.error || null;
	}

	canRetry(): boolean {
		return this.attempts.length < this.maxAttempts;
	}

	onRedirect(to: string, statusCode: number) {
		this.redirectTo = to;
		this.redirectStatus = statusCode;
	}
}
