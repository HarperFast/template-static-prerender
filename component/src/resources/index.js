/**
 * @module index
 *
 * Entry point for prerendering server features.
 *
 * This module wires up endpoints for:
 * - `/page_cache` (see {@link PageCache})
 * - `/render_jobs` (see {@link JobQueue})
 * - `/sitemaps` (see {@link Sitemap})
 *
 * It also provides custom handling for bot-driven `/page` requests,
 * performing cache lookups, validation, and content encoding negotiation.
 */

import { Readable } from 'stream';
import JobQueue from './JobQueue.js';
import Sitemap from './Sitemap.js';
import PageCache from './PageCache.js';
import CacheKey from '../util/CacheKey.js';
import { getAcceptedEncodings, getBestEncoding, reencode } from '../util/contentEncoding.js';
import { sanitizeDeviceType } from '../util/deviceType.js';
import { BOT_PATH_PREFIX, BOT_REQUEST_KEY_NAME, BOT_REQUEST_KEY } from '../util/constants.js';

// Exports /page_cache, /render_jobs, /sitemaps endpoints
/** @type {object} */
export { PageCache as page_cache, JobQueue as render_jobs, Sitemap as sitemaps };

/**
 * Normalize a URL by sorting query parameters into a consistent order.
 *
 * This ensures that cache keys generated from URLs are stable even if
 * query parameters are reordered.
 *
 * @param {string} url - Input URL string.
 * @returns {string} A normalized URL string with sorted query parameters.
 */
const normalizeUrl = (url) => {
	const parsedUrl = new URL(url);
	parsedUrl.searchParams.sort();
	let finalUrl = parsedUrl.href;
	if (parsedUrl.href.endsWith('/')) finalUrl = finalUrl.slice(0, -1);
	if (finalUrl.endsWith('?')) finalUrl = finalUrl.slice(0, -1);
	return finalUrl;
};

/**
 * HTTP middleware to handle bot-driven `/page` requests.
 *
 * Validates bot requests using a shared secret, normalizes query parameters,
 * generates cache keys, and serves prerendered content from the page cache.
 *
 * Responses are adapted to the client’s preferred content encoding and
 * include appropriate HTTP headers for caching and analytics.
 *
 * @param {Request} request - Incoming HTTP request.
 * @param {Function} nextHandler - Function to call if the request should fall through.
 * @returns {Promise<Response|*>} A response object if handled, or the next handler’s result.
 */
server.http(
	async (request, nextHandler) => {
		if (request.method === 'GET' && request.url.startsWith(BOT_PATH_PREFIX)) {
			request.handlerPath = 'p';
			const requestHeaders = request.headers;
			const acceptLanguage = requestHeaders.get('accept-language');

			// Validate bot request secret key
			if (BOT_REQUEST_KEY_NAME && requestHeaders.get(BOT_REQUEST_KEY_NAME) !== BOT_REQUEST_KEY) {
				return {
					headers: new Headers(),
					status: 401,
				};
			}

			// Extract query parameters
			const queryString = request.url.slice(BOT_PATH_PREFIX.length);
			const params = new URLSearchParams(queryString);

			let url;
			if (params.has('url')) {
				url = normalizeUrl(params.get('url'));
			} else {
				// Get values from request body as fallback
				const hostname = requestHeaders.get('host');
				const path = requestHeaders.get('path') || '';
				url = normalizeUrl(`https://${hostname}${path}`);
			}

			let deviceType;
			if (requestHeaders.has('x-device-type')) {
				deviceType = sanitizeDeviceType(requestHeaders.get('x-device-type'));
			} else {
				deviceType = sanitizeDeviceType(params.get('deviceType'));
			}

			// Record analytics for bot request
			server.recordAnalytics(true, 'accept_language', acceptLanguage, 'GET', deviceType);

			// Generate cache key for lookup
			const cacheKey = CacheKey.serialize({ url, deviceType, acceptLanguage });

			const responseHeaders = (request.responseHeaders = new Headers());

			// Handle response asynchronously with timeout
			try {
				let timedOut = false;
				const timeout = setTimeout(() => {
					timedOut = true;
				}, 8000);

				// Lookup page in cache
				const page = await databases.prerender.PageCache.get(cacheKey, request);

				if (!timedOut) {
					clearTimeout(timeout);

					// Ensure blob content errors are logged and handled
					if (page.content instanceof Blob) {
						page.content.on('error', (error) => {
							logger.error('Blob error', error);
							page.invalidate();
						});
					}

					// Apply headers from upstream if available
					const upstreamHeaders = page.headers ? JSON.parse(page.headers) : {};

					if (page.statusCode === 200) {
						// Force HTML-specific response headers
						upstreamHeaders['content-encoding'] = 'gzip';
						upstreamHeaders['content-type'] = 'text/html; charset=utf-8';
						upstreamHeaders['x-harper-rendered'] = '1';
						upstreamHeaders['vary'] = 'Accept-Encoding, Accept-Language';
					}

					// Merge headers into response
					for (const [key, value] of Object.entries(upstreamHeaders)) {
						if (key === 'server-timing') {
							responseHeaders.append(key, value);
						} else {
							responseHeaders.set(key, value);
						}
					}

					// Handle non-200 responses directly
					if (page.statusCode !== 200) {
						return {
							headers: responseHeaders,
							status: page.statusCode,
							wasCacheMiss: page.wasLoadedFromSource(),
						};
					}

					// Retrieve body (cached or origin response)
					let body = page.content || request.originResponseData;
					if (body) {
						const contentEncoding = responseHeaders.get('content-encoding') || null;

						// Negotiate best encoding with client
						const bestEncoding = getBestEncoding(
							getAcceptedEncodings(request.headers.get('accept-encoding')),
							contentEncoding
						);

						// Re-encode response if needed
						if (bestEncoding !== contentEncoding) {
							if (bestEncoding) {
								responseHeaders.set('content-encoding', bestEncoding);
							}

							if (body instanceof Blob) {
								body = Readable.fromWeb(body.stream());
							}

							body = reencode(body, contentEncoding, bestEncoding, false);

							// Remove length header as content length may change
							responseHeaders.delete('content-length');
						}
					}

					return {
						headers: responseHeaders,
						status: page.statusCode,
						body,
						wasCacheMiss: page.wasLoadedFromSource(),
					};
				} else {
					return {
						headers: {
							'retry-after': '10',
							'cache-control': 'no-store',
						},
						status: 503,
					};
				}
			} catch (error) {
				logger.error(error);
				return {
					headers: {},
					status: 500,
				};
			}
		}
		return nextHandler(request);
	},
	{ runFirst: true }
);
