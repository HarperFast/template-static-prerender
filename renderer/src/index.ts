import { JobQueue } from './JobQueue.js';
import RenderWorker from './Worker.js';
import { CHROME_ARGS, CONCURRENCY, JOB_BUFFER_SIZE } from './env.js';
import { fetchJobs, register, sendJobResult } from './external/http.js';
import renderer from './renderer.js';
import logger from './util/Logger.js';

await register();

const jobQueue = await JobQueue.init({
	capacity: JOB_BUFFER_SIZE,
	fetchJobs,
});

const worker = new RenderWorker({
	maxConcurrency: CONCURRENCY,
	browserExpirationThreshold: 200,
	rps: 8,
	jobQueue,
	browserLaunchOptions: {
		timeout: 20000,
		headless: 'shell',
		ignoreDefaultArgs: ['--disable-dev-shm-usage'],
		args: CHROME_ARGS,
	},
	renderer,
	onJobResult(job) {
		sendJobResult(job).catch((err: any) => {
			logger.error(err);
		});
	},
});

worker.start();
