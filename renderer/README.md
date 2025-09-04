# Renderer Service

The **Renderer** is a headless browser–based worker service designed to fetch jobs from Harper component orchestrator, render web pages in a controlled Puppeteer environment, and push the results back. It communicates with the Harper component's orchestrator over **HTTP** and **MQTT**.

This should be run in a separate instance from the Harper component due to intensive resource requirements. See the [Setup](#setup) section below for details on deploying the renderer.

For additional information on using [Puppeteer](https://pptr.dev/category/introduction)
For additional information on running [Puppeteer in Docker](https://github.com/puppeteer/puppeteer/tree/main/docker)

---

## Integration with Harper Component Orchestrator

The renderer service integrates with the Harper component's orchestrator through a standardized communication protocol:

### **HTTP API Integration**

- **Worker Registration**: Registers with orchestrator on startup via `/render_jobs` endpoint
- **Job Claiming**: Polls orchestrator for available render jobs using `claim-jobs` operation
- **Content Upload**: Uploads gzipped rendered HTML back to orchestrator via `/render_jobs/content`

### **MQTT Integration**

- **Queue Status Monitoring**: Subscribes to `queue_status/producer` for real-time job availability updates
- **Error Reporting**: Publishes job failures to `render_jobs/failures` topic for orchestrator retry logic
- **Real-time Coordination**: Enables efficient job distribution without constant HTTP polling

### **Orchestrator Coordination**

The Harper component orchestrator handles:

- Job distribution across multiple renderer service instances
- Content persistence to `pagecache` table after successful renders
- Thread coordination and completion callbacks
- Retry logic for failed renders based on MQTT error reports

---

## Scope

The renderer consists of several cooperating modules:

| Module             | Purpose                                                                                                         |
| ------------------ | --------------------------------------------------------------------------------------------------------------- |
| **index**          | Initializes **RenderWorker** instance and registers with Harper component orchestrator                          |
| **Worker**         | **RenderWorker** class manages job queue, browser worker, and renderer function                                 |
| **JobQueue**       | Queue fed from the orchestrator, uses MQTT status messages to trigger fetches and keeps a `RingBuffer` of jobs. |
| **RingBuffer**     | Fixed–size circular buffer used to store jobs in memory.                                                        |
| **ManagedBrowser** | Wrapper around Puppeteer's `Browser` object with max page tracking, error handling, and force–kill support.     |
| **renderer**       | Rendering function that operates on a Puppeteer `Page` and a `RenderJob` to produce HTML snapshots.             |
| **HTTP handling**  | Fetch jobs, register workers, and send job results using the orchestrator's REST API.                           |
| **MQTT handling**  | Subscribe to orchestrator status updates and publish job failure events.                                        |

---

## Setup

### **Environment Variables**

The renderer requires these environment variables to connect to the Harper component orchestrator. See `.env.example`.

| Variable        | Description                              |
| --------------- | ---------------------------------------- |
| `HDB_HOST`      | Harper component host url                |
| `HDB_HTTP_PORT` | Harper component HTTP API port           |
| `HDB_MQTT_PORT` | Harper component MQTT/WebSocket port     |
| `HDB_USER`      | Harper renderer username                 |
| `HDB_PASS`      | Harper renderer password                 |
| `WORKER_ID`     | Unique identifier for worker instance    |
| `NODE_ENV`      | Environment (affects protocol selection) |

### **Communication Protocol**

The renderer follows this workflow with the orchestrator:

1. **Startup**: Register worker with orchestrator using Basic authentication
2. **Job Discovery**: Monitor MQTT `queue_status/producer` topic for job availability
3. **Job Claiming**: Poll `/render_jobs` endpoint with `claim-jobs` operation when jobs are available
4. **Content Processing**: Render HTML using Puppeteer for claimed job URLs
5. **Content Upload**: Gzip compress and POST rendered content to `/render_jobs/content`
6. **Error Handling**: Report failures via MQTT `render_jobs/failures` topic for orchestrator retry

### **Deploy with Docker**

Once the renderer code is on your VM instance, you can build and run it inside Docker. Repeat this process for each `renderer` instance, ensuring a unique `WORKER_ID` is set for each

1. Navigate to the Project Root

```bash
cd /path/to/renderer
```

2. Build the Docker Image

```bash
docker build -t prerender/renderer .
```

3. Start the Container

```bash
docker compose up -d
```

4. Check Logs for Proper Startup

```bash
docker logs -f renderer
```

### **Protocol Selection**

The renderer automatically selects communication protocols based on `NODE_ENV`:

- **Production**: HTTPS for HTTP API, WSS (WebSocket Secure) for MQTT
- **Development**: HTTP for HTTP API, standard MQTT for pub/sub messaging

### **Authentication**

All HTTP requests to the orchestrator require Basic authentication:

```
Authorization: Basic <base64(HDB_USER:HDB_PASS)>
```

MQTT connections authenticate using the same HarperDB credentials specified in environment variables.
