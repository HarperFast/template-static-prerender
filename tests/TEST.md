# Tests Overview

This document provides a guide to the testing strategy used for the Harper `template-static-prerender` component. It covers both integration and performance testing workflows, along with the utilities and configurations necessary to support consistent, reliable, and automated test execution.

The goal of this testing framework is to ensure:

- APIs and services behave as expected under both normal and high load conditions.

- Repositories can be easily onboarded into CI/CD pipelines with standardized tooling.

- Dynamic environments (e.g. dev, stage, prod) are supported through flexible configuration and secret-based injection.

### Extending the Test Suite

The tests provided in this repository are intended as a starting point for integration and performance testing.
They demonstrate how to structure, run, and collect results using Harper's recommended workflows and utilities.

However, these examples alone will not guarantee full coverage or optimal performance validation for your application.

> For each client projects:
>
> - Expand the test suite to include all critical endpoints, workflows, and edge cases relevant to the use case.
> - Add performance scenarios tailored to expected production loads and usage patterns.

### Test Types Covered

1. **Integration Tests** – Validate API functionality and behavior by running end-to-end tests against a Harper instance running in Docker. These are typically executed using Supertest and support dynamic coverage tracking with Vitest.

2. **Performance Tests** – Use k6 to simulate varying traffic patterns (concurrent users or request-per-second) to benchmark and validate page caching behavior, latency, and reliability under load.

### Test Data Preparation

Performance tests rely on real-world URLs that must be pre-cached before tests are executed.

- `utils/website_urls.txt`: This file is consumed by `performance.test.js` using K6's SharedArray data loader. The URLs are used to simulate GET requests against the `/page/cache` endpoint.

Before running performance tests, ensure the database is seeded with the listed URLs and has had time to populate its internal cache. This ensures meaningful and consistent performance metrics during load testing.

## Integration Testing

### Purpose

`integration.test.js`

This performs integration testing against the Harper prerender component. It includes testing to:

- Verify that core API endpoints are accessible and return expected responses.
- Exercise CRUD operations across key resources: `/sitemaps`, `/render_jobs`, `/PageMeta`, `/PageCache`, and `/queue_status`.
- Ensure authentication and security headers are correctly handled.

### Usage

Run with Vitest:

```bash
npm run test
```

> **Note:** The tests assume you have the Harper component running either locally (in Docker or on your computer) or in a live instance.

### Required Input

- A running Harper `template-static-prerender` component instance (local dev, local docker, or remote).
- Accessible test URLs and/or sitemap endpoints for validation.
- Credentials for Basic Auth (default: HDB_ADMIN / password).

### Configurable Environment Variables

- `TEST_DOMAIN` — Base URL of the test target (default: `https://localhost:9926`).
- `HDB_ADMIN_USERNAME` — Admin username for Basic Auth (default: `HDB_ADMIN`).
- `HDB_ADMIN_PASSWORD` — Admin password for Basic Auth (default: `password`).

### Output

- Executes assertions against each endpoint and reports pass/fail results via Vitest.
- Confirms expected HTTP status codes, JSON response structures, and HTML cache responses.
- Provides validation that critical functionality (health, sitemap scheduling, render job orchestration, queue management, and cached page retrieval) is working correctly in the integrated system.

## Performance Testing

### Purpose

`performance.test.js`

This K6 script performs load testing against the Harper prerender component. It supports two test modes:

- **RPS mode** (default): Uses `constant-arrival-rate` executor to simulate request throughput (RPS).
- **VUs mode**: Uses `constant-vus` executor to simulate concurrent users.

It sends HTTP GET requests to pre-seeded cached URLs (defined in `website_urls.txt`) to validate stability, responsiveness, and throughput of the target Harper instance.

### Usage

Run this script using `k6 run`, setting the desired mode and parameters via `--env` flags.

> Example (RPS mode):

```bash
k6 run \
  -e MODE=rps \
  -e RATE_LEVELS='50,100,300,500,700,900' \
  -e HOST=myhost.example.com \
  -e PORT=9926 \
  -e USER=HDB_ADMIN \
  -e PASSWORD='mysecret' \
  --summary-export=tests/performance/k6_summary.json \
  tests/performance/performance.test.js 2>&1 | tee tests/performance/k6_summary.log
```

> Example (VUs mode):

```bash
k6 run \
  -e MODE=vus \
  -e VU_LEVELS='10,20,40,60,80,100' \
  -e HOST=myhost.example.com \
  -e PORT=9926 \
  -e USER=HDB_ADMIN \
  -e PASSWORD='mysecret' \
  --summary-export=tests/performance/k6_summary.json \
  tests/performance/performance.test.js 2>&1 | tee tests/performance/k6_summary.log
```

### Required Input

- A running Harper `template-static-prerender` component instance. This should be a remote instance with connection to a live `renderer` instance to get the most accurate results.
- Credentials for Basic Auth (default: HDB_ADMIN / password).
- `tests/utils/website_urls.txt`: List of page URLs (max 5000) to test. These URLs should already be cached in the `prerender` database `PageCache` table before running the test.

### Configurable ENV Variables

| Name               | Description                                  | Default          |
| ------------------ | -------------------------------------------- | ---------------- |
| `MODE`             | Test mode: `'rps'` or `'vus'`                | `rps`            |
| `HOST`             | Target host for Harper                       | _(required)_     |
| `PORT`             | Target port                                  | `9926`           |
| `USER`             | Harper admin username                        | _(required)_     |
| `PASSWORD`         | Harper admin password                        | _(required)_     |
| `VU_LEVELS`        | Comma-separated VU levels for `vus` mode     | `10,20,40,60...` |
| `PLATEAU`          | Test duration per VU level                   | `60s`            |
| `PLATEAU_SEC`      | Numeric seconds for plateau duration         | `60`             |
| `RATE_LEVELS`      | Comma-separated request rates for `rps` mode | `50,100,...`     |
| `RATE_PLATEAU`     | Test duration per RPS level                  | `60s`            |
| `RATE_PLATEAU_SEC` | Numeric seconds for RPS plateau duration     | `60`             |
| `BUFFER_SEC`       | Time between level transitions               | `10`             |
| `TIME_UNIT`        | K6 rate time unit                            | `1s`             |
| `GRACEFUL_STOP`    | Time to allow for graceful stop per scenario | `10s`            |
| `DUR_P95`          | Target 95th percentile response time (ms)    | `500`            |

### Metrics Collected

- `http_req_duration` with thresholds per scenario
- `reqs`, `status_ok`, and `header_ok` custom counters

### Output

- Summary printed to console
- JSON output via `--summary-export`
- Logs viewable in `tests/performance/k6_summary.log`
