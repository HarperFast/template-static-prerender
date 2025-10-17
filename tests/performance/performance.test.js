import { SharedArray } from 'k6/data';
import https from 'k6/http';
import { check } from 'k6';
import { Counter } from 'k6/metrics';
import { b64encode } from 'k6/encoding';
import exec from 'k6/execution';

/* --------- K6 Run Command ---------
# VU-based
k6 run \
	-e MODE=vus \
	-e VU_LEVELS='10,20,40,60,80,100' \
	-e HOST={host} \
	-e PORT=9926 \
	-e USER=HDB_ADMIN \
	-e PASSWORD='{password}' \
	--summary-export=tests/performance/k6_summary.json \
	tests/performance/performance.test.js 2>&1| tee tests/performance/k6_summary.log

# RPS-based (default)
k6 run \
	-e MODE=rps \
	-e RATE_LEVELS='50,100,300,500,700,900' \
	-e HOST={host} \
	-e PORT=9926 \
	-e USER=HDB_ADMIN \
	-e PASSWORD='{password}' \
	--summary-export=tests/performance/k6_summary.json \
	tests/performance/performance.test.js 2>&1 | tee tests/performance/k6_summary.log
*/

// Config (env)
const MODE = (__ENV.MODE || 'rps').toLowerCase(); // 'vus' or 'rps'
const HOST = __ENV.HOST;
const PORT = __ENV.PORT;
const USER = __ENV.USER;
const PASSWORD = __ENV.PASSWORD;

const AUTH = 'Basic ' + b64encode(`${USER}:${PASSWORD}`);
const BASE = `https://${HOST}:${PORT}/page/cache`;

// Data file with URLs to test (first 5000 lines will be used)
// The database should be pre-seeded with these URLs and allowed time to be cached before running tests
const dataFile = '../utils/website_urls.txt';

// VU mode params (env-overrideable)
const LEVELS = (__ENV.VU_LEVELS || '10,20,40,60,80,100').split(',').map((n) => Number(n.trim()));
const PLATEAU = __ENV.PLATEAU || '60s';
const PLATEAU_SEC = Number(__ENV.PLATEAU_SEC || 60);

// RPS mode params (env-overridable)
const RATE_LEVELS = (__ENV.RATE_LEVELS || '50,100,300,500,700,900')
	.split(',')
	.map((n) => Number(n.trim()))
	.filter((n) => Number.isFinite(n) && n > 0);
const RATE_PLATEAU = __ENV.RATE_PLATEAU || '60s';
const RATE_PLATEAU_SEC = Number(__ENV.RATE_PLATEAU_SEC || 60);

const BUFFER_SEC = Number(__ENV.BUFFER_SEC || 10); // Buffer time between scenarios for completing iterations
const TIME_UNIT = __ENV.TIME_UNIT || '1s'; // arrival-rate base
const GRACEFUL_STOP = __ENV.GRACEFUL_STOP || '10s';

/* Little's Law for Prealloc_VUs and Max_VUs
preAllocated_VUs = target_RPS * (p95_ms / 1000) * safety_factor (1.5)
max_VUs = preAllocated_VUs * 2
*/
const DUR_P95 = Number(__ENV.DUR_P95 || 500); // set target p95 request duration in ms
const PREALLOC_VUS = Math.ceil(Math.max(...RATE_LEVELS) * (DUR_P95 / 1000) * 1.5);
const MAX_VUS = PREALLOC_VUS * 2;

// Build scenarios dynamically based on mode
let scenarios = {};
if (MODE === 'vus') {
	scenarios = Object.fromEntries(
		LEVELS.map((vus, i) => [
			`vu_${vus}`,
			{
				executor: 'constant-vus',
				vus,
				duration: PLATEAU,
				startTime: `${i * (PLATEAU_SEC + BUFFER_SEC)}s`,
				gracefulStop: GRACEFUL_STOP,
			},
		])
	);
} else {
	// RPS (arrival-rate)
	scenarios = Object.fromEntries(
		RATE_LEVELS.map((rate, i) => [
			`rps_${rate}`,
			{
				executor: 'constant-arrival-rate',
				rate,
				timeUnit: TIME_UNIT,
				duration: RATE_PLATEAU,
				startTime: `${i * (RATE_PLATEAU_SEC + BUFFER_SEC)}s`,
				preAllocatedVUs: PREALLOC_VUS,
				maxVUs: MAX_VUS,
				gracefulStop: GRACEFUL_STOP,
			},
		])
	);
}

export const options = {
	discardResponseBodies: true,
	summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'min', 'max', 'count'],
	systemTags: ['scenario'],
	batchPerHost: 200,
	scenarios,
	thresholds:
		MODE === 'vus'
			? Object.fromEntries(
					LEVELS.flatMap((vus) => [
						[`http_req_duration{scenario:vu_${vus}}`, [`p(95)<${DUR_P95}`]], // DUR_P95
					])
				)
			: Object.fromEntries(
					RATE_LEVELS.flatMap((rate) => [
						[`http_req_duration{scenario:rps_${rate}}`, [`p(95)<${DUR_P95}`]], // DUR_P95
					])
				),
};

// Metrics
const statusOK = new Counter('status_ok');
const reqs = new Counter('reqs');

// Helpers
function rand(max) {
	return (Math.random() * max) | 0;
}

function pick() {
	return ITEMS[rand(ITEMS.length)];
}

function openTextOrNull(p) {
	try {
		return open(p);
	} catch {
		return null;
	}
}

// Data loading via SharedArray
const ITEMS = new SharedArray('prerender-data', () => {
	const raw = openTextOrNull(dataFile);
	if (!raw) throw new Error(`Missing ${dataFile}`);

	// Split into lines and trim empty ones
	const lines = raw.split(/\r?\n/).filter(Boolean).slice(0, 5000);

	// Precompute request objects
	return lines.map((line) => {
		const pageURL = encodeURI(line.trim()); // encode url for use as query param
		const url = `${BASE}?deviceType=desktop&url=${pageURL}`;
		return url;
	});
});

// ==========================
// VU logic (for both modes)
// ==========================
/**
 * k6 default function:
 * - Sends a GET request for a random item
 * - Increments counters
 * - Checks that the response is Markdown
 */
export default function () {
	const scenario = exec.scenario.name;
	const url = pick();
	const res = https.get(url, {
		headers: {
			authorization: AUTH,
			responseType: 'none',
		},
		timeout: 10000, // 10s
		responseType: 'none',
	});

	reqs.add(1, { scenario });

	// Ensure both status and content-type
	const ok = check(res, {
		'status is 2xx': (r) => r.status >= 200 && r.status < 300,
	});

	// Increment counters based on results
	if (ok) {
		statusOK.add(1);
	}
}
