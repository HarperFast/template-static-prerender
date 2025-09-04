import http from 'k6/http';
import { check, sleep } from 'k6';

const TEST_DOMAIN = __ENV.TEST_DOMAIN || 'http://localhost:9925';

console.log(`Testing domain: ${TEST_DOMAIN}`);
export const options = {
	stages: [
		{ duration: '10s', target: 2 }, // ramp-up to 2 users
		{ duration: '10s', target: 2 }, // stay at 2 users
		{ duration: '10s', target: 0 }, // ramp-down
	],
	thresholds: {
		http_req_duration: ['p(95)<100'], // 95% of requests <100ms
		http_req_failed: ['rate<0.01'], // <1% errors
	},
};

export default function () {
	const response = http.get(`${TEST_DOMAIN}/health`);

	check(response, {
		'status is 200': (res) => res.status === 200,
		'response body not empty': (res) => res.body && res.body.length > 0,
	});

	sleep(1); // brief pause between iterations
}
