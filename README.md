# Static Prerender Template

This template project consists of the Harper component in `component` and the rendering service in `renderer`. Additional details for each can be found in their corresponding `README.md` files.

## Architecture Overview

The system operates with two main components:

- **Component**: Harper caching layer that stores and serves prerendered content, also acts as the pub/sub orchestator for managing render jobs with the `renderer`
- **Renderer**: Headless browser service that generates static HTML from dynamic web pages and returns content to the Harper `component`

## Render Service Options

### Default: Puppeteer (Included)

This project includes a Puppeteer-based render service that uses Chrome in headless mode to generate static HTML snapshots of web pages.

**Why Puppeteer was selected:**

- **Performance**: Fast startup times (~50-100ms) and efficient memory usage
- **JavaScript Support**: Full ES6+ and modern web API compatibility
- **Reliability**: Stable Chrome DevTools Protocol with excellent error handling
- **Resource Control**: Fine-grained control over network requests, cookies, and viewport settings
- **Ecosystem**: Large community, extensive documentation, and active maintenance
- **Docker Compatibility**: Well-supported containerization with official Chrome images

### Bring Your Own Render Service

The system supports custom render services through a standardized interface. Alternative rendering solutions can be integrated by implementing the required endpoints and response formats.

#### Alternative Render Technologies

**Playwright**

- **Pros**: Multi-browser support (Chrome, Firefox, Safari), faster execution, built-in waiting strategies
- **Cons**: Larger resource footprint, more complex setup
- **Use Case**: When cross-browser compatibility testing is required

**Chrome DevTools API**

- **Pros**: Direct protocol access, minimal overhead, maximum control
- **Cons**: Lower-level implementation required, more complex error handling
- **Use Case**: High-performance scenarios requiring custom browser automation

**Selenium WebDriver**

- **Pros**: Mature ecosystem, extensive browser support, familiar API
- **Cons**: Slower execution, higher resource usage, deprecated architecture
- **Use Case**: Legacy system integration or existing Selenium infrastructure

**Prerender.io / Rendertron**

- **Pros**: Managed service options, optimized for SEO, minimal maintenance
- **Cons**: External dependency, potential latency, cost considerations
- **Use Case**: When outsourcing render infrastructure is preferred

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

- **Protocol:** `wss` (WebSocket Secure) in production, `mqtt` in development
- **Port:** Uses `HDB_HTTP_PORT` for WSS, `HDB_MQTT_PORT` for MQTT
- **Authentication:** HarperDB username and password
- **Connection URL:** `{protocol}://{HDB_HOST}:{port}`

#### Required MQTT Topics

**Job Failure Reporting**

```javascript
Topic: 'render_jobs/failures'
Message: {
  "id": "<job-id>",
  "workerId": "<worker-id>",
  "attempts": <number-of-attempts>
}
Options: { qos: 0, retain: false }
```

**Additional Topics (for monitoring)**

- `queue_status/producer`: Job queue status updates ("empty" or "queued")
- `render_jobs/job`: Individual job processing updates

### Integration Workflow

1. **Environment Setup**: Configure all required environment variables
2. **Worker Registration**: Call register-worker operation on service startup
3. **MQTT Connection**: Establish authenticated connection to Harper component MQTT broker
4. **Job Processing Loop**:
   - Poll for jobs using claim-jobs operation
   - Process URLs with your rendering technology
   - Gzip compress rendered HTML content
   - Upload results via content endpoint
5. **Error Handling**: Report job failures via MQTT failures topic
6. **Monitoring**: Use MQTT topics to monitor queue status and job updates

### Authentication

All HTTP requests require Basic authentication using HarperDB credentials:

```
Authorization: Basic <base64(HDB_USER:HDB_PASS)>
```

### Protocol Selection

- **Production**: HTTPS/WSS (`NODE_ENV=production`)
- **Development**: HTTP/MQTT (default)

### Data Structures

**RenderJob Object**

- `id`: Unique job identifier
- `url`: Target URL to render
- `content`: Rendered HTML content (populated after processing)
- `attempts`: Number of processing attempts
- `status`: Job status

The cache component orchestrator handles job distribution, content storage, and retry logic, while the render service focuses solely on generating HTML content from URLs. This separation allows for flexible rendering technology choices while maintaining consistent caching behavior.

The modular design allows teams to choose the rendering solution that best fits their infrastructure, performance requirements, and maintenance capabilities while maintaining consistent caching behavior through the HarperDB component.
