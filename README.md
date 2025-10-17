# Static Prerender Template

This repository provides a complete template for deploying a static prerendering system built on **Harper** and a **headless rendering service**. It is designed for SEO optimization and consistent static snapshots of dynamic web applications.

The project consists of two main modules:

- **Component (`component/`)**
  The Harper-based caching layer that stores and serves prerendered content.
  It also orchestrates rendering jobs, manages job queues, schedules refreshes, and coordinates with rendering workers.

- **Renderer (`renderer/`)**
  A headless browser service (default: Puppeteer) that generates static HTML snapshots of dynamic pages.
  The renderer processes jobs from the Harper component and pushes results back into the cache.

Each module has its own `README.md` with deeper technical details.

---

## Architecture Overview

The system operates in two cooperating layers:

1. **Component Layer (Harper)**
   - Serves prerendered pages from cache.
   - Coordinates rendering jobs across workers using pub/sub.
   - Schedules periodic refreshes of cached pages.
   - Provides APIs for sitemap ingestion and page cache management.

2. **Renderer Layer (Headless Service)**
   - Executes jobs sent from Harper.
   - Launches headless browsers, emulates devices, and extracts static HTML.
   - Returns gzip-compressed prerendered results.
   - Reports status and updates job queues over HTTP + MQTT.

This separation of **orchestration** and **rendering** ensures flexibility: Harper manages caching and scheduling, while the renderer can be swapped out (Puppeteer, Playwright, Rendertron, etc.).

---

## Render Service Options

### Default: Puppeteer (Included)

The repository ships with a Puppeteer-based renderer. It uses headless Chrome to capture dynamic pages as static HTML.

**Why Puppeteer?**

- **Performance**: Fast startup and efficient memory usage.
- **Modern Web Support**: Handles ES6+, Web Components, and CSS shims.
- **Reliability**: Stable Chrome DevTools Protocol implementation.
- **Resource Control**: Request interception, headers, device emulation.
- **Docker-Ready**: Works smoothly with Chrome container images.

### Bring Your Own Renderer

The system supports alternative render services via a standard interface.
Any renderer can be integrated by implementing required endpoints and data exchange formats.

**Alternative Rendering Technologies**

- **Playwright** – Multi-browser, modern automation, good for cross-browser tests.
- **Chrome DevTools Protocol** – Direct low-level control, optimized for performance.
- **Selenium WebDriver** – Legacy compatibility, slower, higher resource usage.
- **Rendertron / Prerender.io** – Managed or hosted services, minimal maintenance.

See below for **integration requirements**.

---

#### Integration Steps for Alternative Render Service

> **Note:** Ensure Harper `component` is running with databases and tables created for `orchestrator.js` to manage communication with render service

## Custom Render Service Integration Requirements

### Environment Variables

Your custom render service must be configured with these environment variables. Reference the `.env.example` in `renderer` for more details:

```bash
HDB_HOST=<harperdb-hostname>
HDB_HTTP_PORT=<http-port>
HDB_MQTT_PORT=<mqtt-port>
HDB_USER=<harperdb-username>
HDB_PASS=<harperdb-password>
WORKER_ID=<unique-worker-identifier>
NODE_ENV=<production|development>
```

### HTTP Communication

Your custom render service must implement HTTP client communication with the Harper component:

#### Worker Registration

```http
POST /render_jobs
Content-Type: application/json
Authorization: Basic <base64-encoded-credentials>
x-worker-id: <worker-identifier>

{
  "op": "register-worker"
}
```

#### Job Claiming

```http
POST /render_jobs
Content-Type: application/json
Authorization: Basic <base64-encoded-credentials>
x-worker-id: <worker-identifier>

{
  "op": "claim-jobs",
  "limit": <number-of-jobs>
}
```

**Response:** Array of RenderJob objects containing job details to process.

#### Content Upload

```http
POST /render_jobs/content
Content-Type: text/html
Content-Encoding: gzip
Authorization: Basic <base64-encoded-credentials>
x-worker-id: <worker-identifier>
x-job-id: <job-identifier>

<gzipped-html-content>
```

**Expected Response:** `204 No Content` for successful upload.

### MQTT Communication

Your custom render service must establish MQTT connection for real-time messaging:

#### Connection Configuration

- **Protocol:** `wss` (WebSocket Secure) in production, `ws` (WebSocket) in development
- **Port:** Uses `HDB_MQTT_PORT`
- **Authentication:** Harper username and password
- **Connection URL:** `{protocol}://{HDB_HOST}:{HTTP_MQTT_PORT}`

#### Required MQTT Topics

- `queue_status/producer`: Job queue status updates ("empty" or "queued")
- `render_worker/<WORKER_ID>/queue`: Worker-specific job queue

### Integration Workflow

1. **Environment Setup**: Configure all required environment variables
2. **Worker Registration**: Call register-worker operation on service startup
3. **MQTT Connection**: Establish authenticated connection to Harper component MQTT broker
4. **Job Processing Loop**:
   - Poll for jobs using claim-jobs operation
   - Process URLs with your rendering technology
   - Gzip compress rendered HTML content
   - Upload results via content endpoint
5. **Monitoring**: Use MQTT topics to monitor queue status and job updates

### Authentication

All HTTP requests require Basic authentication using Harper credentials:

```http
Authorization: Basic <base64(HDB_USER:HDB_PASS)>
```

### Protocol Selection

- **Production**: HTTPS/WSS (`NODE_ENV=production`)
- **Development**: HTTP/WS (default)

### Data Structures

**RenderJob Object**

```json
{
	"id": "123",
	"url": "https://example.com",
	"priority": 2,
	"headers": { "accept-language": "en-US" },
	"deviceType": "desktop",
	"acceptLanguage": "en-US",
	"attempts": 0,
	"status": "pending"
}
```

The cache component orchestrator handles job distribution, content storage, and retry logic, while the render service focuses solely on generating HTML content from URLs. This separation allows for flexible rendering technology choices while maintaining consistent caching behavior.

The modular design allows teams to choose the rendering solution that best fits their infrastructure, performance requirements, and maintenance capabilities while maintaining consistent caching behavior through the Harper component.
