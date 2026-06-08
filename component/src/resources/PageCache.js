/**
 * @module PageCache
 *
 * Provides a caching layer for prerendered pages.
 *
 * Responsibilities include:
 * - Handling cache lookups and on-demand rendering when content is missing.
 * - Whitelisting and forwarding request headers during rendering.
 * - Storing prerendered HTML and associated metadata in the database.
 * - Allowing stale-while-revalidate semantics for improved performance.
 *
 * Integrates with:
 * - {@link ManagedPage} for page registration and metadata.
 * - {@link render} for initiating prerendering jobs.
 * - {@link CacheKey} for uniquely identifying cached content.
 */

import { databases } from 'harper';
import ManagedPage from './ManagedPage.js';
import { render } from '../util/render.js';
import CacheKey from '../util/CacheKey.js';
import { REQ_HEADERS_WHITELIST } from '../util/constants.js';

const pageSource = {
	/**
	 * Retrieve or render a page for the given cache key.
	 *
	 * - Ensures the page is registered as a {@link ManagedPage}.
	 * - Forwards only whitelisted headers to the renderer.
	 * - Calls the render service and captures HTML output.
	 * - Returns a cache entry object with metadata.
	 *
	 * @param {string} cacheKey - Serialized cache key identifying the page.
	 * @param {object} context - Request context wrapper.
	 * @param {Request} context.requestContext - The original HTTP request.
	 * @returns {Promise<object>} Cache entry object containing:
	 * - `cacheKey`: The cache key.
	 * - `statusCode`: HTTP status code of the render.
	 * - `headers`: Serialized response headers.
	 * - `content`: Blob content (if status 200).
	 * - `lastRefreshed`: Timestamp of retrieval.
	 */
	async get(cacheKey, context) {
		const { requestContext: request } = context;
		const { url, deviceType, acceptLanguage } = CacheKey.deserialize(cacheKey);

		// Ensure the page is managed before rendering
		const pageInfo = await ManagedPage.get(url, request);

		if (pageInfo) {
			// Forward only whitelisted headers
			const incomingRequestHeaders = request.headers.asObject;
			let forwardHeaders = {};
			Object.keys(incomingRequestHeaders).forEach((h) => {
				if (REQ_HEADERS_WHITELIST.includes(h.toLowerCase())) {
					forwardHeaders[h] = incomingRequestHeaders[h];
				}
			});

			// Trigger prerender
			const result = await render({
				url,
				forwardHeaders,
				deviceType,
				acceptLanguage,
				waitForResponse: true,
				priority: 0,
			});

			const statusCode = result.statusCode;
			let responseHeaders = result.headers || {};
			let content;
			if (statusCode === 200) {
				content = await createBlob(result.stream);
			} else {
				// Don’t cache failures
				context.noCacheStore = true;
				request.originResponseData = result.stream;
			}

			if (content instanceof Blob) {
				content.on('error', (err) => {
					logger.error('Blob error', err);
					// Invalidate the cache entry via the table (v5: records are frozen plain objects)
					databases.prerender.PageCache.invalidate(cacheKey);
				});
			}

			return {
				cacheKey,
				url,
				statusCode,
				headers: JSON.stringify(responseHeaders),
				deviceType,
				acceptLanguage,
				content,
				lastRefreshed: Date.now(),
			};
		} else {
			logger.warn(`Request for ${url}, not a managed page`);
		}
	},
};

/**
 * Page cache resource for prerendered pages.
 *
 * Extends `databases.prerender.PageCache` and overrides
 * read behavior to enforce access rules and caching strategy.
 */
export default class PageCache extends databases.prerender.PageCache {
	static directURLMapping = true;

	/**
	 * Checks if a read request is allowed based on User-Agent.
	 *
	 * @param {*} _user - Unused user parameter.
	 * @param {*} query - Unused query parameter.
	 * @param {Request} req - The incoming request.
	 * @returns {boolean} - True if allowed, otherwise false.
	 */
	allowRead(_user, _query, req) {
		const userAgent = req.headers.get('User-Agent');

		if (!userAgent) {
			logger.warn('No User-Agent header present');
			return false;
		}

		return true;
	}

	/**
	 * Whether stale cache entries may be served while revalidating.
	 *
	 * @returns {boolean} Always returns true.
	 */
	allowStaleWhileRevalidate() {
		return true;
	}

	/**
	 * Retrieves cached page content with headers and status.
	 * Sets gzip encoding by default.
	 * @param {object} target - The request target (RequestTarget extends URLSearchParams).
	 * @returns {Promise<object>} - Response with status, data, and headers.
	 */
	static async get(target) {
		const record = await super.get(target);

		if (!record?.content) {
			return {
				status: record?.statusCode || 404,
				data: {
					data: 'Page Not Found',
					contentType: 'text/plain',
				},
			};
		}

		// Check for blob errors. In v5, records are frozen plain objects — use
		// databases.prerender.PageCache.invalidate(key) instead of record.invalidate().
		if (record.content instanceof Blob) {
			record.content.on?.('error', (err) => {
				logger.error('Blob error', err);
				databases.prerender.PageCache.invalidate(record.cacheKey);
			});
		}

		// Build response headers as a plain object. Stored headers (if any) take
		// precedence; defaults ensure content-type and content-encoding are always set.
		// Note: do NOT return a Headers instance here — Harper v5's REST mergeHeaders
		// calls new Headers(responseData.headers) which fails with a WHATWG Headers
		// iterable. Pass a plain object instead.
		let storedHeaders = {};
		try {
			storedHeaders = typeof record.headers === 'string'
				? (JSON.parse(record.headers) || {})
				: (record.headers || {});
		} catch {
			logger.warn('PageCache.get: could not parse stored headers for', record.cacheKey);
		}

		return {
			status: record.statusCode || 200,
			data: {
				data: record.content,
				contentType: storedHeaders['content-type'] || 'text/html; charset=utf-8',
			},
		};
	}
}

// Set page cache source for database
databases.prerender.PageCache.sourcedFrom(pageSource);
