import https from 'https';
import request from 'supertest';
import { describe, it, expect, beforeAll } from 'vitest';

const TEST_DOMAIN = process.env.TEST_DOMAIN || 'https://localhost:9926';
const HDB_ADMIN_USERNAME = process.env.HDB_ADMIN_USERNAME || 'HDB_ADMIN';
const HDB_ADMIN_PASSWORD = process.env.HDB_ADMIN_PASSWORD || 'password';

// Required for sitemap tests
const TEST_SITEMAP_URL = 'https://www.harper.fast/sitemap.xml';
const TEST_URL_LIST = ['https://www.harper.fast', 'https://www.harper.fast/resources'];

let authAgent;
beforeAll(() => {
	const insecureAgent = new https.Agent({ rejectUnauthorized: false });
	const authToken = Buffer.from(`${HDB_ADMIN_USERNAME}:${HDB_ADMIN_PASSWORD}`).toString('base64');
	const authHeader = `Basic ${authToken}`;

	authAgent = (method, path) =>
		request(TEST_DOMAIN)[method](path).agent(insecureAgent).set('Authorization', authHeader);
});

// Test the /sitemaps endpoint
describe('/sitemaps endpoint', () => {
	const TEST_LIST_ID = 'my_test_url_list';

	describe('POST /sitemaps (scheduled refresh)', () => {
		it('should schedule refresh for a real sitemap', async () => {
			const res = await authAgent('post', '/sitemaps').send({
				sitemapURL: TEST_SITEMAP_URL,
				refreshInterval: 86400000,
				isSitemap: true,
				deviceTypes: ['desktop', 'mobile'],
			});
			expect(res.status).toBe(200);

			// Wait for 1 second to allow the sitemap to be processed
			// Otherwise the other tests may run before the sitemap is processed and fail
			await new Promise((resolve) => setTimeout(resolve, 1000));
		});

		it('should schedule refresh for a direct URL list', async () => {
			const res = await authAgent('post', '/sitemaps').send({
				sitemapURL: TEST_LIST_ID,
				refreshInterval: 86400000,
				isSitemap: false,
				urlList: TEST_URL_LIST,
				deviceTypes: ['desktop'],
			});
			expect(res.status).toBe(200);
		});
	});
});

// Test the /PageMeta endpoint
describe('/PageMeta endpoint', () => {
	describe('GET /PageMeta', () => {
		it('should return a list of page meta data', async () => {
			const res = await authAgent('get', '/PageMeta/');
			expect(res.status).toBe(200);
			expect(Array.isArray(res.body)).toBe(true);
			expect(res.body.length).toBeGreaterThan(0);
			expect(res.body[0]).toHaveProperty('url');
		});
	});

	describe('GET /PageMeta?url={url}', () => {
		it('should return a list of page meta data by URL', async () => {
			const res = await authAgent('get', `/PageMeta?url=${encodeURIComponent(TEST_URL_LIST[0])}`);
			expect(res.status).toBe(200);
			expect(Array.isArray(res.body)).toBe(true);
			expect(res.body.length).toBeGreaterThan(0);
			expect(res.body[0]).toHaveProperty('url', TEST_URL_LIST[0]);
		});
	});
});

// Test the /queue_status endpoint
describe('/queue_status endpoint', () => {
	describe('GET /queue_status', () => {
		it('should return the current producer queue status', async () => {
			const res = await authAgent('get', '/queue_status/');
			expect(res.status).toBe(200);
			expect(Array.isArray(res.body)).toBe(true);
		});
	});
});

// Test the /PageCache endpoint
describe('/PageCache endpoint', () => {
	describe('GET /PageCache', () => {
		it('should return a list of cached pages', async () => {
			const res = await authAgent('get', '/PageCache/');
			expect(res.status).toBe(200);
			expect(Array.isArray(res.body)).toBe(true);
		});
	});
});

// Test the /render_jobs endpoint
describe('/render_jobs endpoint', () => {
	describe('GET /render_jobs', () => {
		it('should return a list of render jobs', async () => {
			const res = await authAgent('get', '/render_jobs/');
			expect(res.status).toBe(200);
			expect(Array.isArray(res.body)).toBe(true);
		});
	});
});
