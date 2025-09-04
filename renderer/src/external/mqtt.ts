import mqtt from 'mqtt';
import { STATE, HDB_MQTT_PORT, HDB_PASS, HDB_USER, WORKER_ID } from '../env.js';

const protocol = process.env.NODE_ENV === 'production' ? `wss` : 'ws';

/**
 * Known MQTT topics used by the render jobs system.
 */
export const Topic = {
	jobSchedulerStatus: 'queue_status/producer',
	workerQueue: `render_worker/${WORKER_ID}/queue`,
};

export type JobProducerStatus = 'empty' | 'queued';

export const mqttClient = await mqtt.connectAsync(`${protocol}://${STATE.HDB_HOST}:${HDB_MQTT_PORT}`, {
	clean: true,
	clientId: WORKER_ID,
	username: HDB_USER,
	password: HDB_PASS,
	wsOptions: {
		protocol: 'mqtt',
	},
});
