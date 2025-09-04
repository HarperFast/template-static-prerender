import { gzip } from 'zlib';
import { Pool } from 'undici';
import { promisify } from 'node:util';
import { STATE, HDB_HTTP_PORT, HDB_PASS, HDB_USER, WORKER_ID, setHdbHost, CONCURRENCY } from '../env.js';
import RenderJob from '../RenderJob.js';
import logger from '../util/Logger.js';

const pGzip = promisify(gzip);

const protocol = process.env.NODE_ENV === 'production' ? `https` : 'http';

let pool = new Pool(`${protocol}://${STATE.HDB_HOST}`, { connections: 1 });

const BASE_CONFIG = {
	method: 'POST',
	headers: {
		'Content-Type': 'application/json',
		'x-worker-id': WORKER_ID!,
		'authorization': `Basic ${Buffer.from(`${HDB_USER}:${HDB_PASS}`).toString('base64')}`,
	},
	keepalive: true,
};

export const fetchJobs = async (limit: number): Promise<RenderJob[]> => {
	logger.info(`Worker ${WORKER_ID} fetching jobs...`);
	const res = await pool.request({
		...BASE_CONFIG,
		headers: {
			...BASE_CONFIG.headers,
		},
		path: '/render_jobs',
		body: JSON.stringify({
			op: 'claim-jobs',
			limit,
		}),
	});

	const data: any = await res.body.json();
	return data;
};

export const register = async (): Promise<void> => {
	logger.info(`Worker ${WORKER_ID} registering...`);
	const res = await fetch(`${protocol}://${STATE.HDB_HOST}:${HDB_HTTP_PORT}/render_jobs`, {
		...BASE_CONFIG,
		headers: {
			...BASE_CONFIG.headers,
		},
		body: JSON.stringify({
			op: 'register-worker',
		}),
	});

	if (!res.ok) {
		await res.bytes();
		throw new Error(res.statusText);
	}

	const data = await res.json();

	setHdbHost(data.host);

	pool.destroy();
	pool = new Pool(`${protocol}://${STATE.HDB_HOST}:${HDB_HTTP_PORT}`, { connections: CONCURRENCY });
};

export const sendJobResult = async (job: RenderJob): Promise<void> => {
	logger.info(`Worker ${WORKER_ID} sending job ${job.id} result...`);
	const headers: Record<string, string> = {
		...BASE_CONFIG.headers,
		'x-worker-id': WORKER_ID!,
		'x-job-id': job.id,
	};

	if (job.redirectTo && job.redirectStatus) {
		headers['x-redirect-to'] = job.redirectTo;
		headers['x-redirect-status'] = job.redirectStatus.toString();
	}

	if (job.latestAttempt?.renderEndTime) {
		headers['x-render-time'] = (job.latestAttempt.renderEndTime - job.latestAttempt.renderStartTime).toString();
	}

	if (job.httpResponse) {
		Object.entries(job.httpResponse.headers).forEach(([key, val]) => {
			headers[`x-origin-header-${key.toLowerCase()}`] = val;
		});
		headers['x-origin-status'] = job.httpResponse.statusCode.toString();
	}

	let body = undefined;

	if (job.content) {
		const compressed = await pGzip(job.content, { level: 6 });
		body = compressed;
		headers['content-type'] = job.httpResponse!.headers['content-type'] || 'text/html; charset=utf-8';
	}

	const res = await pool.request({
		...BASE_CONFIG,
		path: '/render_jobs/result',
		body,
		headers,
	});

	if (res.statusCode && res.statusCode != 204) {
		throw new Error(`Failed to send job result for ${job.url}: ${res.statusCode}`);
	} else {
		await res.body.bytes();
	}
};
