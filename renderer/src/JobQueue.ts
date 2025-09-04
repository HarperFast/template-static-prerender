import { EventEmitter } from 'node:events';
import RenderJob from './RenderJob.js';
import { JobProducerStatus, mqttClient, Topic } from './external/mqtt.js';
import logger from './util/Logger.js';
import Denque from 'denque';

export type JobFetchFn = (count: number) => Promise<RenderJob[]>;

export type JobQueueConfig = {
	capacity: number;
	fetchJobs: JobFetchFn;
	fetchThreshold?: number;
};

export class JobQueue extends EventEmitter {
	// Queue status for diagnostics; not used for flow control.
	status: 'idle' | 'fetching' | 'paused' = 'idle';

	// Low-water mark for triggering fetch.
	_autoFetchThreshold: number;

	_priorityQueue: Denque<RenderJob> = new Denque();
	_normalQueue: Denque<RenderJob> = new Denque();

	// Application-provided function to fetch new jobs.
	_fetchJobs: JobFetchFn;

	// True while a fetch is in flight (prevents concurrent fetches).
	isFetching = false;

	capacity: number;

	// Latest known upstream producer status from MQTT (e.g., `empty` | `ready`).
	jobProducerStatus: JobProducerStatus = 'empty';

	static async init(config: JobQueueConfig) {
		const jobQueue = new JobQueue(config);

		mqttClient.on('message', (topic: string, msg: Buffer) => jobQueue.handleMessage(topic, msg));
		await mqttClient.subscribeAsync({
			[Topic.jobSchedulerStatus]: { qos: 1 },
			[Topic.workerQueue]: { qos: 1 },
		});

		return jobQueue;
	}

	constructor({ capacity, fetchJobs, fetchThreshold }: JobQueueConfig) {
		super();

		this.capacity = capacity;

		this._normalQueue = new Denque([], { capacity });

		this._fetchJobs = fetchJobs;

		this._autoFetchThreshold = fetchThreshold ?? capacity / 2;

		// Initial hydration attempt; will be a no-op if producer is `empty` or buffer above threshold.
		this._tryHydrateBuffer();
	}

	handleMessage(topic: string, payload: Buffer) {
		if (topic === Topic.jobSchedulerStatus) {
			const d = JSON.parse(payload.toString());
			this.jobProducerStatus = d.status as JobProducerStatus;
			this._tryHydrateBuffer();
		} else if (topic === Topic.workerQueue) {
			const jobData = JSON.parse(payload.toString());
			const job = new RenderJob(jobData);
			this._priorityQueue.push(job);
			this.emit('jobs');
		}
	}

	peek(): RenderJob | null {
		return this._priorityQueue.peekFront() || this._normalQueue.peekFront() || null;
	}

	next(): RenderJob | null {
		const job = this._priorityQueue.shift() || this._normalQueue.shift();
		this._tryHydrateBuffer();
		return job || null;
	}

	async _tryHydrateBuffer() {
		if (this.isFetching) return;
		if (this._normalQueue.length > this._autoFetchThreshold) return;
		if (this.jobProducerStatus === 'empty') return;

		this.isFetching = true;

		try {
			const prevEmptySlots = this._normalQueue.size();
			const jobs = await this._fetchJobs(prevEmptySlots);

			jobs.forEach((job) => this._normalQueue.push(new RenderJob(job)));

			if (prevEmptySlots === this.capacity && jobs.length > 0) {
				this.emit('jobs');
			}
		} catch (err: any) {
			logger.error({ err }, 'Failed to fetch jobs');
		}

		this.isFetching = false;

		if (this.listenerCount('fetching') > 0) {
			this.emit('fetching');
		}
	}
}
