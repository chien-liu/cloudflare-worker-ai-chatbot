// Allowed origins for CORS requests
const ALLOWED_ORIGIN = [
	'http://localhost:3000', // Local development
	'http://localhost:8787', // Local development (Wrangler)
	'https://chienliu.com', // Production
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

export default {
	async fetch(request, env, ctx) {
		const startTime = Date.now(); // Track request start time
		const requestOrigin = request.headers.get('Origin');

		// Reject requests from unauthorized origins
		if (!requestOrigin || !ALLOWED_ORIGIN.includes(requestOrigin)) {
			return new Response(JSON.stringify({ error: 'Forbidden' }), {
				status: 403,
				headers: {
					'Content-Type': 'application/json',
				},
			});
		}

		const CORS_HEADERS = getCorsHeaders(requestOrigin);

		// 1. Handle CORS preflight requests
		if (request.method === 'OPTIONS') {
			return new Response(null, {
				status: 204, // Correct status for preflight
				headers: CORS_HEADERS,
			});
		}

		try {
			// 2. Process AI request
			const { prompt, user_input } = await request.json();
			const response = await env.AI.run(
				'@cf/meta/llama-3-8b-instruct',
				{
					prompt: prompt,
				},
				{
					gateway: {
						id: 'react-chatbot-gateway',
					},
				}
			);

			const responseTime = Date.now() - startTime; // Calculate response time

			// Log asynchronously without blocking response
			ctx.waitUntil(
				Promise.resolve().then(() => {
					console.log('Request processed:', {
						request_origin: requestOrigin,
						user_input,
						response,
						response_time_ms: responseTime, // Add response time in milliseconds
					});
				})
			);

			// 3. Successful Response
			return new Response(JSON.stringify(response), {
				headers: {
					'Content-Type': 'application/json',
					...CORS_HEADERS, // Include all CORS headers on success
				},
			});
		} catch (e) {
			// Log errors asynchronously
			ctx.waitUntil(
				Promise.resolve().then(() => {
					console.error('Error processing request:', {
						error: e.message,
						stack: e.stack,
					});
				})
			);
			// 4. Error Handling (Crucial for CORS)
			const errorResponse = { error: 'Failed to process request.' };
			return new Response(JSON.stringify(errorResponse), {
				status: 500,
				headers: {
					'Content-Type': 'application/json',
					...CORS_HEADERS, // Include CORS headers on error
				},
			});
		}
	},
};
