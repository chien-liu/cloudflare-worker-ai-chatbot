/**
 * API routes:
 * - `/` allows browser CORS requests from the configured origins below.
 * - `/notes` and `/notes/:id` do not allow CORS and are intended to be called
 *   from a local CLI or other non-browser client with `WRITE_API_TOKEN`.
 */

import { Buffer } from 'node:buffer';
import { timingSafeEqual } from 'node:crypto';
import { Hono } from 'hono';

import { RAGWorkflow } from './rag-workflow';

// Allowed origins for CORS requests
const ALLOWED_ORIGIN = [
	'https://chienliu.com', // Production
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

function isAuthorizedRequest(c) {
	const expected = c.env.WRITE_API_TOKEN;
	if (!expected) {
		console.error('WRITE_API_TOKEN is not configured');
		return false;
	}

	const authHeader = c.req.header('Authorization') || '';
	if (!authHeader.startsWith('Bearer ')) return false;

	const provided = authHeader.slice('Bearer '.length);
	const providedBuffer = Buffer.from(provided);
	const expectedBuffer = Buffer.from(expected);

	if (providedBuffer.length !== expectedBuffer.length) return false;
	return timingSafeEqual(providedBuffer, expectedBuffer);
}

const app = new Hono();

// Handle preflight CORS requests
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
			},
		);

		const responseTime = Date.now() - startTime;

		console.log('Request processed:', {
			request_origin: requestOrigin,
			user_input,
			response,
			response_time_ms: responseTime,
		});

		return new Response(JSON.stringify(response), {
			headers: {
				'Content-Type': 'application/json',
				...corsHeaders,
			},
		});
	} catch (e) {
		const error = e instanceof Error ? e : new Error(String(e));

		console.error('Error processing request:', {
			error: error.message,
			stack: error.stack,
		});

		return new Response(JSON.stringify({ error: 'Failed to process request.' }), {
			status: 500,
			headers: {
				'Content-Type': 'application/json',
				...corsHeaders,
			},
		});
	}
});

// Insert notes into RAG workflow which will handle vectorization and storage
app.post('/notes', async (c) => {
	if (!isAuthorizedRequest(c)) {
		return c.text('Unauthorized', 401);
	}

	const { text } = await c.req.json();
	if (!text) return c.text('Missing text', 400);
	await c.env.RAG_WORKFLOW.create({ params: { text } });
	return c.text('Created note', 201);
});

// Endpoint to delete notes by ID
app.delete('/notes/:id', async (c) => {
	if (!isAuthorizedRequest(c)) {
		return c.text('Unauthorized', 401);
	}

	const { id } = c.req.param();

	const query = `DELETE FROM notes WHERE id = ?`;
	await c.env.DB.prepare(query).bind(id).run();

	await c.env.VECTORIZE_INDEX.deleteByIds([id]);

	return c.status(204);
});

// The error message does not expose internal details, but the error is logged for debugging
app.onError((err, c) => {
	return c.text('Internal Server Error', 500);
});

export { RAGWorkflow }; // Export the workflow for Cloudflare environment bindings
export default app;
