import request from 'supertest';
import { describe, it, expect } from 'vitest';

const TEST_DOMAIN = process.env.TEST_DOMAIN || 'http://localhost:9925';

console.log(`Testing domain: ${TEST_DOMAIN}`);
describe('GET /health', () => {
	it('should return 200 OK with expected response', async () => {
		const agent = request.agent(TEST_DOMAIN);
		const res = await agent.get('/health');

		expect(res.status).toBe(200);
	});
});
