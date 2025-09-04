import path from 'path';
import { KnownDevices, Page } from 'puppeteer';
import RenderJob from './RenderJob.js';
import { Renderer } from './Worker.js';
import { GOTO_TIMEOUT, WAIT_FOR_EVENT } from './env.js';

const renderer: Renderer = async (page: Page, job: RenderJob): Promise<string | undefined> => {
	const { url, deviceType, acceptLanguage } = job;

	const setupPromises = [
		page.setRequestInterception(true),
		page.evaluateOnNewDocument(
			`customElements.forcePolyfill = true;ShadyDOM = {force: true};ShadyCSS = {shimcssproperties: true}`
		),
	];

	if (acceptLanguage) {
		setupPromises.push(
			page.setExtraHTTPHeaders({
				'Accept-Language': acceptLanguage,
			})
		);
	}

	switch (deviceType) {
		case 'mobile':
			setupPromises.push(
				page.setUserAgent(KnownDevices['iPhone 15'].userAgent),
				page.setViewport({
					width: 390,
					height: 844,
					deviceScaleFactor: 1,
					isMobile: true,
					hasTouch: true,
				})
			);
			break;
		case 'tablet':
			setupPromises.push(
				page.setUserAgent(KnownDevices['iPad'].userAgent),
				page.setViewport({
					width: 768,
					height: 1024,
					deviceScaleFactor: 2,
					isMobile: true,
					hasTouch: false,
				})
			);
			break;
		default:
			setupPromises.push(
				page.setViewport({
					width: 1920,
					height: 1080,
					deviceScaleFactor: 3,
					isMobile: false,
					hasTouch: false,
				})
			);
			break;
	}

	const abortController = new AbortController();
	let aborted = false;

	page
		.on('request', (req) => {
			if (aborted) {
				req.abort();
				return;
			}

			if (req.isNavigationRequest()) {
				const headers = req.headers();

				headers['x-seo-prerender-request'] = 'true';

				if (job.headers) {
					Object.keys(job.headers).forEach((header) => {
						headers[header.toLowerCase()] = job.headers![header];
					});
				}

				req.continue({ headers });
			} else if (req.resourceType() === 'image' || req.resourceType() === 'media' || req.resourceType() === 'font') {
				req.abort();
			} else {
				// For all other requests, continue without modification
				req.continue();
			}
		})
		.on('response', (res) => {
			const req = res.request();
			if (req.isNavigationRequest() && req.frame() === page.mainFrame()) {
				const status = res.status();
				const headers = res.headers();
				if (status >= 400) {
					job.httpResponse = {
						statusCode: status,
						headers,
					};
					abortController.abort();
					aborted = true;
				} else if (status >= 300 && headers.location) {
					const baseUrl = new URL(req.url()).origin;
					job.onRedirect(new URL(headers.location, baseUrl).href, status);
				}
			}
		});

	await Promise.all(setupPromises);

	// Normalize CSS behavior regardless of host/device defaults.
	await page.emulateMediaType('screen');
	await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);

	// Navigate to target URL, waiting based on configured event.
	const finalRes = await page.goto(url, {
		waitUntil: WAIT_FOR_EVENT,
		timeout: GOTO_TIMEOUT[WAIT_FOR_EVENT] || 30000,
		signal: abortController.signal,
	});

	if (finalRes) {
		job.httpResponse = job.httpResponse || {
			statusCode: finalRes.status(),
			headers: finalRes.headers(),
		};
		const statusCode = job.httpResponse.statusCode;

		if (statusCode === 200 || statusCode === 202 || statusCode === 304) {
			const { origin, pathname = '' } = URL.parse(page.url())!;
			const content = await page.evaluate(postProcess, origin, path.dirname(pathname));

			return content;
		}
	}
};

export default renderer;

function postProcess(origin: string, directory: string) {
	const bases = document.head.querySelectorAll('base');
	if (bases.length) {
		// Patch existing <base> if it is relative.
		const existingBase = bases[0].getAttribute('href') || '';
		if (existingBase.startsWith('/')) {
			// check if is only "/" if so add the origin only
			if (existingBase === '/') {
				bases[0].setAttribute('href', origin);
			} else {
				bases[0].setAttribute('href', origin + existingBase);
			}
		}
	} else {
		// Only inject <base> if it doesn't already exist.
		const base = document.createElement('base');
		// Base url is the current directory
		base.setAttribute('href', origin + directory);
		document.head.insertAdjacentElement('afterbegin', base);
	}

	// Strip only script tags that contain JavaScript (either no type attribute or one that contains "javascript")
	document
		.querySelectorAll('script:not([type]), script[type*="javascript"], script[type="module"], link[rel=import]')
		.forEach((el) => el.remove());

	// Serialize entire document (including DOCTYPE if present via outerHTML path).
	let content = '';
	for (const node of document.childNodes) {
		switch (node) {
			case document.documentElement:
				content += document.documentElement.outerHTML;
				break;
			default:
				content += new XMLSerializer().serializeToString(node);
				break;
		}
	}

	return content;
}
