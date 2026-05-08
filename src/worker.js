/**
 * API routes:
 * - `/chatbot` allows browser CORS requests from the configured origins below.
 * - `PUT /notes/:id` upserts a note with a caller-provided ID and a JSON body.
 * - `DELETE /notes/:id` removes a note from D1 and Vectorize.
 * - `/notes/:id` does not allow CORS and is intended to be called
 *   from a local CLI or other non-browser client with `WRITE_API_TOKEN`.
 */

import { Buffer } from 'node:buffer';
import { timingSafeEqual } from 'node:crypto';
import { Hono } from 'hono';

import { CHAT_MODEL, EMBEDDING_MODEL } from './config';
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

function generateSystemPrompt(notes) {
	const ragSections = [2, 1, 0].map((index) => {
		const note = notes[index]?.trim() || 'No retrieved note.';
		return `### TOP${index + 1}\n${note}`;
	});

	const sections = [
		'You are a personal assistant for Chien (a.k.a. Chien Liu).',
		'',
		'## Verified Context',
		...ragSections,
		'',
		'## Strict Instructions',
		'- ONLY use the "Verified Context" above to answer questions about Chien.',
		'- If the info is missing from the context, say: "That detail isn\'t in Chien\'s profile."',
		'- Use third-person (e.g., "Chien is...").',
		'- Keep responses under 100 words; however, do not cut off sentences just to meet the word limit.',
		'## Response Format',
		'- Questions about Chien: Brief summary + bulleted highlights.',
		'Be professional and confident.',
	];

	return sections.join('\n');
}

const app = new Hono();

// Handle preflight CORS requests
app.options('/chatbot', (c) => {
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

app.post('/chatbot', async (c) => {
	const startTime = Date.now();
	const requestOrigin = c.req.header('Origin');
	const forbiddenResponse = getRequestOriginResponse(requestOrigin);

	if (forbiddenResponse) {
		return forbiddenResponse;
	}

	const corsHeaders = getCorsHeaders(requestOrigin);

	try {
		const { user_input } = await c.req.json();

		// Embed the user question to find relevant notes
		const embeddings = await c.env.AI.run(EMBEDDING_MODEL, { text: user_input });
		const vectors = embeddings.data[0];

		const vectorQuery = await c.env.VECTORIZE_INDEX.query(vectors, { topK: 3 });
		const vecIds = vectorQuery.matches?.map((m) => m.id) ?? [];

		let notes = [];
		if (vecIds.length > 0) {
			const placeholders = vecIds.map(() => '?').join(', ');
			const { results } = await c.env.DB.prepare(`SELECT * FROM notes WHERE id IN (${placeholders})`).bind(...vecIds).run();
			const notesById = new Map(results.map((r) => [String(r.id), r.text]));
			notes = vecIds.map((id) => notesById.get(String(id))).filter((note) => typeof note === 'string' && note.trim());
		}

		const systemPrompt = generateSystemPrompt(notes);

		const response = await c.env.AI.run(
			CHAT_MODEL,
			{
				messages: [
					{ role: 'system', content: systemPrompt },
					{ role: 'user', content: user_input },
				],
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
			rag_notes_count: notes.length,
			message: [
				{ role: 'system', content: systemPrompt },
				{ role: 'user', content: user_input },
			],
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
app.put('/notes/:id', async (c) => {
	if (!isAuthorizedRequest(c)) {
		return c.text('Unauthorized', 401);
	}

	const noteId = c.req.param('id');
	if (!noteId) {
		return c.text('Missing note id', 400);
	}

	const { text } = await c.req.json();
	if (typeof text !== 'string' || !text.trim()) {
		return c.text('Missing text', 400);
	}

	await c.env.RAG_WORKFLOW.create({
		params: {
			id: noteId,
			text,
		},
	});

	return c.text('Upserted note', 202);
});

// Endpoint to delete notes by ID
app.delete('/notes/:id', async (c) => {
	if (!isAuthorizedRequest(c)) {
		return c.text('Unauthorized', 401);
	}

	const noteId = c.req.param('id');
	if (!noteId) {
		return c.text('Missing note id', 400);
	}

	const query = `DELETE FROM notes WHERE id = ?`;
	await c.env.DB.prepare(query).bind(noteId).run();

	await c.env.VECTORIZE_INDEX.deleteByIds([noteId]);

	return c.status(204);
});

// The error message does not expose internal details, but the error is logged for debugging
app.onError((err, c) => {
	return c.text('Internal Server Error', 500);
});

export { RAGWorkflow }; // Export the workflow for Cloudflare environment bindings
export default app;
