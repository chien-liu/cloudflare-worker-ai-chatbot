/**
 * API routes:
 * - `/chatbot` allows browser CORS requests from the configured origins below.
 *   Response JSON format:
 *   {
 *     "response": "Generated answer text",
 *     "response_time_ms": 123
 *   }
 *
 * - `PUT /notes/:id` upserts a note with a caller-provided ID and a JSON body.
 *
 * - `DELETE /notes/:id` removes a note from D1 and Vectorize.
 *
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

function validateRequestOrigin(requestOrigin) {
	return requestOrigin && ALLOWED_ORIGIN.includes(requestOrigin);
}

function isAuthorizedRequest(c) {
	const expected = c.env.WRITE_API_TOKEN;
	if (!expected) return false;

	const authHeader = c.req.header('Authorization') || '';
	if (!authHeader.startsWith('Bearer ')) return false;

	const provided = authHeader.slice('Bearer '.length);
	const providedBuffer = Buffer.from(provided);
	const expectedBuffer = Buffer.from(expected);

	if (providedBuffer.length !== expectedBuffer.length) return false;
	return timingSafeEqual(providedBuffer, expectedBuffer);
}

function generateSystemPrompt(notes, topK) {
	// Create an array [topK, topK-1, ..., 1] to label the notes in order of relevance
	const topKArray = Array.from({ length: topK + 1 }, (_, i) => topK - i);

	const ragSections = topKArray.map((index) => {
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
	const corsHeaders = getCorsHeaders(requestOrigin);

	if (!validateRequestOrigin(requestOrigin)) {
		return c.json({ error: 'Forbidden' }, 403, corsHeaders);
	}

	return c.body(null, 204, corsHeaders);
});

app.post('/chatbot', async (c) => {
	const requestOrigin = c.req.header('Origin');
	const corsHeaders = getCorsHeaders(requestOrigin);

	if (!validateRequestOrigin(requestOrigin)) {
		return c.json({ error: 'Forbidden' }, 403, corsHeaders);
	}

	const requestId = crypto.randomUUID();
	const startTime = Date.now();
	const topK = 3;

	try {
		const { user_input } = await c.req.json();

		// Embed the user question to find relevant notes
		const embeddings = await c.env.AI.run(EMBEDDING_MODEL, { text: user_input });
		const vectors = embeddings.data[0];

		const vectorQuery = await c.env.VECTORIZE_INDEX.query(vectors, { topK });
		const vecIds = vectorQuery.matches?.map((m) => m.id) ?? [];

		let notes = [];
		if (vecIds.length > 0) {
			const placeholders = vecIds.map(() => '?').join(', ');
			const { results } = await c.env.DB.prepare(`SELECT * FROM notes WHERE id IN (${placeholders})`)
				.bind(...vecIds)
				.run();
			const notesById = new Map(results.map((r) => [String(r.id), r.text]));
			notes = vecIds.map((id) => notesById.get(String(id))).filter((note) => typeof note === 'string' && note.trim());
		}

		const systemPrompt = generateSystemPrompt(notes, topK);

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

		console.log({
			requestId,
			message: 'chatbot request processed',
			request_origin: requestOrigin,
			rag_notes_count: notes.length,
			response_time_ms: responseTime,
			prompt_tokens: response.usage?.prompt_tokens,
			completion_tokens: response.usage?.completion_tokens,
		});

		return c.json(
			{
				response: response.choices[0].message.content,
				response_time_ms: responseTime,
			},
			200,
			corsHeaders,
		);
	} catch (e) {
		const error = e instanceof Error ? e : new Error(String(e));

		console.error({
			requestId,
			message: 'chatbot request failed',
			request_origin: requestOrigin,
			error: error.message,
			stack: error.stack,
		});

		return c.json({ error: 'Failed to process request.' }, 500, corsHeaders);
	}
});

// Insert notes into RAG workflow which will handle vectorization and storage.
// WRITE_API_TOKEN is intentionally absent in prod, so this endpoint is dev-only.
// The dev env points to the prod D1 and Vectorize instances, enabling note
// management without exposing the token.
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
// WRITE_API_TOKEN is intentionally absent in prod, so this endpoint is dev-only.
// The dev env points to the prod D1 and Vectorize instances, enabling note
// management without exposing the token.
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

	return c.text(`Note id=${noteId} deleted`);
});

app.onError((err, c) => {
	console.error('[worker] unhandled error:', err);
	return c.text('Internal Server Error', 500);
});

export { RAGWorkflow }; // Export the workflow for Cloudflare environment bindings
export default app;
