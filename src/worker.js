import { Hono } from 'hono';

// Allowed origins for CORS requests
const ALLOWED_ORIGIN = [
	'https://chienliu.com',  // Production
	'http://localhost:3000', // Local development
	'http://localhost:8787', // Local development (Wrangler)
];

// Returns CORS headers with the appropriate origin
function getCorsHeaders(requestOrigin) {
	const origin = ALLOWED_ORIGIN.includes(requestOrigin) ? requestOrigin : ALLOWED_ORIGIN[0];
	return {
		'Access-Control-Allow-Origin': origin,
		'Access-Control-Allow-Methods': 'POST, OPTIONS',
		'Access-Control-Allow-Headers': 'Content-Type',
		'Access-Control-Max-Age': '3600', // Cache preflight response for 1 hour
	};
}

const app = new Hono();

// Return 403 Forbidden if the request origin is not allowed
function getRequestOriginResponse(requestOrigin) {
	if (!requestOrigin || !ALLOWED_ORIGIN.includes(requestOrigin)) {
		return new Response(JSON.stringify({ error: 'Forbidden' }), {
			status: 403,
			headers: {
				'Content-Type': 'application/json',
			},
		});
	}

	return null;
}

app.options('/', (c) => {
	const requestOrigin = c.req.header('Origin');
	const forbiddenResponse = getRequestOriginResponse(requestOrigin);

	if (forbiddenResponse) {
		return forbiddenResponse;
	}

	const corsHeaders = getCorsHeaders(requestOrigin);
	return new Response(null, {
		status: 204,
		headers: corsHeaders,
	});
});

app.post('/', async (c) => {
	const startTime = Date.now();
	const requestOrigin = c.req.header('Origin');
	const forbiddenResponse = getRequestOriginResponse(requestOrigin);

	if (forbiddenResponse) {
		return forbiddenResponse;
	}

	const corsHeaders = getCorsHeaders(requestOrigin);

	try {
		const { prompt, user_input } = await c.req.json();
		const response = await c.env.AI.run(
			'@cf/meta/llama-3.1-8b-instruct-fast',
			{
				prompt,
			},
			{
				gateway: {
					id: 'react-chatbot-gateway',
				},
			}
		);

		const responseTime = Date.now() - startTime;

		c.executionCtx.waitUntil(
			Promise.resolve().then(() => {
				console.log('Request processed:', {
					request_origin: requestOrigin,
					user_input,
					response,
					response_time_ms: responseTime,
				});
			})
		);

		return new Response(JSON.stringify(response), {
			headers: {
				'Content-Type': 'application/json',
				...corsHeaders,
			},
		});
	} catch (e) {
		const error = e instanceof Error ? e : new Error(String(e));

		c.executionCtx.waitUntil(
			Promise.resolve().then(() => {
				console.error('Error processing request:', {
					error: error.message,
					stack: error.stack,
				});
			})
		);

		return new Response(JSON.stringify({ error: 'Failed to process request.' }), {
			status: 500,
			headers: {
				'Content-Type': 'application/json',
				...corsHeaders,
			},
		});
	}
});

export default app;
