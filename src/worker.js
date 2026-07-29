/**
 * API routes:
 * - `/chatbot` allows browser CORS requests from the configured origins below.
 *
 *   Example request (first message, no history):
 *   curl -X POST https://<worker-host>/chatbot \
 *     -H "Content-Type: application/json" \
 *     -H "Origin: <allowed-origin>" \
 *     -d '{"user_input": "Tell me about Chiens docker experience?"}'
 *
 *   Example request (follow-up with conversation history):
 *   curl -X POST https://<worker-host>/chatbot \
 *     -H "Content-Type: application/json" \
 *     -H "Origin: <allowed-origin>" \
 *     -d '{
 *           "user_input": "Ellaborate it.",
 *           "conversation_history": [
 *             { "role": "user", "content": "Tell me about Chiens docker experience?" },
 *             { "role": "assistant", "content": "Chien has experience optimizing Docker images and CI/CD build processes." }
 *           ]
 *         }'
 *   Response JSON format:
 *   {
 *     "response": "Generated answer text",
 *     "response_time_ms": 123
 *   }
 *
 *
 * - `PUT /notes/:id` (local only) upserts a note with a caller-provided ID and a JSON body.
 *
 *   Example request:
 *   curl -X PUT http://localhost:8787/notes/<id> \
 *     -H "Content-Type: application/json" \
 *     -d '{"text": "Chien is a software engineer at Cloudflare."}'
 *
 *
 * - `DELETE /notes/:id` (local only) removes a note from D1 and Vectorize.
 *
 *   Example request:
 *   curl -X DELETE http://localhost:8787/notes/<id>
 *
 *
 * - `/notes/:id` does not allow CORS and is intended to be called from a local CLI with `ADMIN_API_ENABLED`.
 *   In prod, it is also unreachable — the Cloudflare route pattern (`api.chienliu.com/chatbot*`)
 *   only forwards `/chatbot` requests to this Worker, so `/notes/:id` is blocked at the edge.
 */
import { Hono } from 'hono';

import { CHAT_MODEL, EMBEDDING_MODEL } from './config';
import { RAGWorkflow } from './rag-workflow';

// Returns CORS headers with the appropriate origin.
// allowedOrigin comes from wrangler vars: wrangler.jsonc for prod, .env.local for local dev.
function getCorsHeaders(requestOrigin, allowedOrigin) {
	return {
		'Access-Control-Allow-Origin': allowedOrigin,
		'Access-Control-Allow-Methods': 'POST, OPTIONS',
		'Access-Control-Allow-Headers': 'Content-Type',
		'Access-Control-Max-Age': '3600', // Cache preflight response for 1 hour
	};
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
		'- Keep responses under 350 words; however, do not cut off sentences just to meet the word limit.',
		'## Response Format',
		'- Questions about Chien: Brief summary + bulleted highlights.',
		'Be professional and assertive.',
	];

	return sections.join('\n');
}

const app = new Hono();

// Handle preflight CORS requests
app.options('/chatbot', (c) => {
	const requestOrigin = c.req.header('Origin');
	const corsHeaders = getCorsHeaders(requestOrigin, c.env.ALLOWED_ORIGIN);

	if (requestOrigin !== c.env.ALLOWED_ORIGIN) {
		return c.json({ error: 'Forbidden' }, 403, corsHeaders);
	}

	return c.body(null, 204, corsHeaders);
});

app.post('/chatbot', async (c) => {
	const requestOrigin = c.req.header('Origin');
	const corsHeaders = getCorsHeaders(requestOrigin, c.env.ALLOWED_ORIGIN);

	if (requestOrigin !== c.env.ALLOWED_ORIGIN) {
		return c.json({ error: 'Forbidden' }, 403, corsHeaders);
	}

	const requestId = crypto.randomUUID();
	const startTime = Date.now();
	const topK = 3;
	const conversationHistoryLimit = 10;

	const clientIp = c.req.header('CF-Connecting-IP') ?? 'unknown';
	const { success: withinRateLimit } = await c.env.CHATBOT_RATE_LIMITER.limit({ key: clientIp });
	if (!withinRateLimit) {
		console.warn({
			requestId,
			message: 'chatbot request rate limited',
			client_ip: clientIp,
		});
		return c.json({ error: 'Hit rate limit. Please try again later.' }, 429, corsHeaders);
	}

	try {
		const { user_input, conversation_history } = await c.req.json();

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
					...(Array.isArray(conversation_history) ? conversation_history.slice(-conversationHistoryLimit) : []),
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
// Gated by ADMIN_API_ENABLED, which is only set in .env.local and never deployed.
app.put('/notes/:id', async (c) => {
	if (!c.env.ADMIN_API_ENABLED) return c.notFound();

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

// Endpoint to delete notes by ID.
// Gated by ADMIN_API_ENABLED, which is only set in .env.local and never deployed.
app.delete('/notes/:id', async (c) => {
	if (!c.env.ADMIN_API_ENABLED) return c.notFound();

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
