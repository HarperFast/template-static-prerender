import EventEmitter from 'events';
import puppeteer, { Browser, LaunchOptions, Page } from 'puppeteer';
import logger from './util/Logger.js';
import { setTimeout } from 'timers';
import { INCOGNITO_PAGES } from './env.js';

type ManagedBrowserOptions = {
	maxActivePages?: number;
};
type ManagedBrowserConfig = ManagedBrowserOptions & {
	puppeteerLaunchOptions?: LaunchOptions;
};

export default class ManagedBrowser extends EventEmitter {
	// Maximum number of concurrently active pages permitted for this instance.
	maxActivePages: number;

	// Underlying Puppeteer browser.
	browser: Browser;

	/**
	 * Number of outstanding units of work referencing this browser.
	 * Maintained by callers (e.g., worker) to help decide when it's safe to retire.
	 */
	jobRefs: number = 0;

	// Current count of open pages (decremented on page `'close'`).
	activePages: number = 0;

	// Monotonic count of pages opened by this browser (never decremented).
	totalOpenedPages: number = 0;

	protected constructor(browser: Browser, options?: ManagedBrowserOptions) {
		super();
		this.browser = browser;
		this.maxActivePages = options?.maxActivePages ?? 5;
	}

	static async launch(config?: ManagedBrowserConfig) {
		const browser = await puppeteer.launch(config?.puppeteerLaunchOptions);

		browser.on('targetcreated', async (target) => {
			try {
				const page = await target.page();
				if (page) {
					page.on('error', () => {
						page.close().catch((err: any) => {
							logger.error({ err }, 'Failed to close page after error');
						});
					});
				}
			} catch (err: any) {
				logger.error({ err }, 'Failed to launch page');
			}
		});

		const managed = new ManagedBrowser(browser, { maxActivePages: config?.maxActivePages });

		return managed;
	}

	/**
	 * Number of available page slots before hitting `maxActivePages`.
	 */
	get freeSlots() {
		return this.maxActivePages - this.activePages;
	}

	async getPage() {
		this.activePages++;
		this.totalOpenedPages++;

		let page;
		try {
			// Create a new browser
			const context = await (!INCOGNITO_PAGES
				? this.browser.defaultBrowserContext()
				: this.browser.createBrowserContext({ downloadBehavior: { policy: 'deny' } }));

			page = await context.newPage();
			page.once('close', async () => {
				if (INCOGNITO_PAGES) {
					try {
						await context.close();
					} catch (err: any) {
						logger.error({ err }, 'Failed to close context.');
					}
				}
				this.activePages--;
				if (this.activePages === this.maxActivePages - 1) {
					this.emit('open-slot');
				}
			});
		} catch (err: any) {
			this.activePages--;
			if (this.activePages === this.maxActivePages - 1) {
				this.emit('open-slot');
			}
			throw err;
		}

		return page;
	}

	/**
	 * Closes the given Puppeteer page.
	 * Errors during close are ignored.
	 */
	async closePage(page: Page) {
		try {
			await page.close();
		} catch (err: any) {
			logger.error({ err }, 'Failed to close page.');
		}
	}

	/**
	 * Attempts to close the browser gracefully.
	 * Schedules a force kill after 5 seconds to ensure the process exits.
	 */
	async close() {
		try {
			await this.browser.close();
		} catch (err: any) {
			logger.error({ err }, 'Failed to close browser');
		}

		setTimeout(() => {
			this.kill().catch((err: any) => logger.error({ err }, 'Failed to kill process'));
		}, 5000);
	}

	/**
	 * Force kills the underlying browser process with `SIGKILL` if not already closed.
	 * Also attempts a graceful close before sending SIGKILL.
	 */
	async kill() {
		const process = this.browser.process();

		if (!process) {
			return;
		}

		const timeout = setTimeout(() => {
			process?.kill('SIGKILL');
		}, 5000);

		try {
			await this.browser.close();
			clearTimeout(timeout);
		} catch (err: any) {
			logger.error({ err }, 'Failed to kill browser');
		}
	}
}
