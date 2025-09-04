import { JobQueue } from './JobQueue.js';
import ManagedBrowser from './ManagedBrowser.js';
import { LaunchOptions, Page, ProtocolError, TimeoutError } from 'puppeteer';
import RenderJob from './RenderJob.js';
import logger from './util/Logger.js';

export type Renderer = (page: Page, job: RenderJob) => Promise<string | undefined>;

let lastNormalJobStartedAt = 0;

type RenderWorkerConfig = {
	// The max number of concurrent page renders
	maxConcurrency?: number;

	// The total number of pages that can be rendered by the browser before it is replaced
	browserExpirationThreshold?: number;

	// The renderer function that will be used to render pages
	renderer: Renderer;

	rps?: number;

	/**
	 * Options forwarded to `puppeteer.launch`. These are used whenever
	 * a new {@link ManagedBrowser} instance is created.
	 */
	browserLaunchOptions?: LaunchOptions;

	// Source of work items to render.
	jobQueue: JobQueue;

	onJobResult?: (job: RenderJob) => void;
};

export default class RenderWorker {
	// Current scheduler state.
	status: 'running' | 'stopped' = 'stopped';

	// Maximum parallel renders allowed.
	maxConcurrency: number;

	// Page-open count threshold for retiring the current browser.
	browserExpirationThreshold: number;

	// Milliseconds between scheduler ticks.
	jobStartDelay: number;

	// Application-provided render function.
	renderFn: Renderer;

	// True while a new browser is being launched. Prevents duplicate launches.
	isLaunchingBrowser = false;

	// The active managed browser (or `null` if not yet launched / being relaunched).
	browser: ManagedBrowser | null = null;

	// Browsers that are retired and pending close.
	retiredBrowsers: Set<ManagedBrowser> = new Set();

	// Source of jobs.
	jobQueue: JobQueue;

	// Options for `puppeteer.launch`.
	browserLaunchOptions?: LaunchOptions;

	// Periodic cleanup timer for retired browsers.
	private browserCleanupInterval: NodeJS.Timeout | null = null;

	// Scheduler timer handle (setTimeout).
	private jobStartInterval: NodeJS.Timeout | null = null;

	// Callback invoked after each job attempt finishes.
	onJobResult: (job: RenderJob) => void;

	// Current number of active render tasks.
	activeRenders: number = 0;

	logStatsInterval: NodeJS.Timeout;

	rps = 10;

	tickRate: number;

	constructor(config: RenderWorkerConfig) {
		this.browserLaunchOptions = config.browserLaunchOptions;
		this.maxConcurrency = config.maxConcurrency ?? 5;
		this.browserExpirationThreshold = config.browserExpirationThreshold ?? 5000;
		this.renderFn = config.renderer;
		this.jobQueue = config.jobQueue;
		this.onJobResult = config.onJobResult || (() => {});

		// Periodically attempt to close retired browsers with no active work.
		this.browserCleanupInterval = setInterval(() => {
			this.closeRetiredBrowsers();
		}, 10000);
		this.browserCleanupInterval.unref();

		this.logStatsInterval = setInterval(() => {
			this.logStats();
		}, 45000);

		if (config.rps) {
			this.rps = config.rps;
		}
		this.jobStartDelay = Math.floor(1000 / this.rps);
		this.tickRate = Math.max(Math.floor(this.jobStartDelay / 5), 1);

		process.on('uncaughtException', (err: any) => {
			logger.error({ err }, 'Uncaught Exception');
			this.destroy();
			process.exit(1);
		});
	}

	tick = () => {
		if (this.status === 'stopped') {
			return;
		}

		this.startNextJob();

		this.jobStartInterval = setTimeout(this.tick, this.jobStartDelay);
	};

	start() {
		if (this.status === 'running') return;
		this.logStats();
		this.status = 'running';
		this.tick();
	}

	pause(_caller: string) {
		if (this.jobStartInterval !== null) {
			this.status = 'stopped';
			this.logStats();
			clearInterval(this.jobStartInterval);
			this.jobStartInterval = null;
		}
	}

	logStats() {
		const numQueued = this.jobQueue._priorityQueue.size() + this.jobQueue._normalQueue.size();

		logger.info({
			status: this.status,
			totalQueued: numQueued,
			normalQueueSize: this.jobQueue._normalQueue.size(),
			priorityQueueSize: this.jobQueue._priorityQueue.size(),
			activeRenders: this.activeRenders,
			retiredBrowsers: this.retiredBrowsers.size,
			launchingBrowser: this.isLaunchingBrowser,
			currentBrowser: this.browser
				? {
						totalOpenedPages: this.browser.totalOpenedPages,
						activePages: this.browser.activePages,
						freeSlots: this.browser.freeSlots,
						jobRefs: this.browser.jobRefs,
					}
				: null,
		});
	}

	async launchBrowser() {
		this.pause('launchBrowser');
		this.isLaunchingBrowser = true;
		logger.info({
			event: 'launching browser',
			retired: this.retiredBrowsers.size,
			launching: this.isLaunchingBrowser,
		});

		try {
			const browser = await ManagedBrowser.launch({
				maxActivePages: this.maxConcurrency,
				puppeteerLaunchOptions: this.browserLaunchOptions,
			});
			this.browser = browser;
		} catch (err: any) {
			logger.error({ err }, 'Failed to launch browser');
		}

		this.isLaunchingBrowser = false;
		logger.info({
			event: 'launched browser',
			retired: this.retiredBrowsers.size,
			launching: this.isLaunchingBrowser,
		});
		if (this.status === 'stopped') {
			this.start();
		}
	}

	destroy() {
		if (this.browserCleanupInterval !== null) {
			clearInterval(this.browserCleanupInterval);
			this.browserCleanupInterval = null;
		}

		if (this.jobStartInterval !== null) {
			this.jobStartInterval.unref();
			clearInterval(this.jobStartInterval);
			this.jobStartInterval = null;
		}

		// Close all browsers (ignore close errors).
		if (this.browser) {
			this.browser.close().catch(() => {});
		}

		this.retiredBrowsers.forEach((browser) => {
			browser.close().catch(() => {});
		});
		this.browser = null;
		this.retiredBrowsers.clear();
	}

	closeRetiredBrowsers() {
		for (const browser of this.retiredBrowsers) {
			if (browser.activePages === 0 || browser.jobRefs === 0) {
				browser.close().then(() => {
					this.retiredBrowsers.delete(browser);
				});
			}
		}
	}

	retireBrowser(browser: ManagedBrowser) {
		if (this.retiredBrowsers.has(browser)) {
			return;
		}

		this.retiredBrowsers.add(browser);
		this.browser = null;
		if (!this.isLaunchingBrowser) {
			this.launchBrowser();
		}
	}

	async render(browser: ManagedBrowser, job: RenderJob) {
		this.activeRenders++;
		browser.jobRefs++;

		if (job.priority > 0) {
			lastNormalJobStartedAt = Date.now();
		}
		job.attemptStarted();

		let page: Page | undefined;
		let error: Error | undefined;
		let content: string | undefined;

		try {
			page = await browser.getPage();
		} catch (e: any) {
			this.retireBrowser(browser);
			error = e as Error;
			logger.error({ error }, 'Failed to get page');
		}

		if (page && !page.isClosed()) {
			try {
				content = await this.renderFn(page, job);
			} catch (e: any) {
				if (e instanceof TimeoutError || e instanceof ProtocolError) {
					this.retireBrowser(browser);
				}

				error = e as Error;
				logger.error({ url: job.url, error }, 'Failed to render page');
			}
		}

		job.attemptEnded(error, content);
		browser.jobRefs--;
		this.onJobResult(job);

		if (page) {
			await browser.closePage(page);
		}
		this.activeRenders--;
	}

	getBrowser() {
		if (this.browser === null) {
			if (!this.isLaunchingBrowser) {
				this.launchBrowser();
			}
			return null;
		}
		if (this.browser.freeSlots > 0) {
			return this.browser;
		}
		return null;
	}

	startNextJob() {
		if (this.activeRenders >= this.maxConcurrency) {
			return;
		}

		const browser = this.getBrowser();

		if (browser) {
			const peekedJob = this.jobQueue.peek();

			if (peekedJob && peekedJob.priority > 0 && Date.now() - lastNormalJobStartedAt < this.jobStartDelay) {
				return;
			}

			const job = this.jobQueue.next();

			if (job) {
				if (browser.totalOpenedPages >= this.browserExpirationThreshold) {
					this.retireBrowser(browser);
				}
				this.render(browser, job);
			} else {
				this.pause('startNextJob');
				this.jobQueue.once('jobs', () => {
					this.start();
				});
			}
		} else {
			this.pause('startNextJob');

			if (this.browser && this.browser.freeSlots === 0) {
				this.browser.once('open-slot', () => {
					this.start();
				});
			}
		}
	}
}
