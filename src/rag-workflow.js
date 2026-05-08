import { WorkflowEntrypoint } from 'cloudflare:workers';

import { EMBEDDING_MODEL } from './config';

export class RAGWorkflow extends WorkflowEntrypoint {
	async run(event, step) {
		const env = this.env;
		const { id, text } = event.payload;

		const record = await step.do(`upsert database record`, async () => {
			const query = 'INSERT INTO notes (id, text) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET text = excluded.text RETURNING *';
			const { results } = await env.DB.prepare(query).bind(id, text).run();

			const record = results[0];
			if (!record) throw new Error('Failed to create note');
			console.log('[rag-workflow] created database record:', record.id);
			return record;
		});

		const embedding = await step.do(`generate embedding`, async () => {
			const embeddings = await env.AI.run(EMBEDDING_MODEL, {
				text,
			});
			const values = embeddings.data[0];
			if (!values) throw new Error('Failed to generate vector embedding');
			console.log('[rag-workflow] generated embedding for record:', record.id);
			return values;
		});

		await step.do(`insert vector`, async () => {
			const result = await env.VECTORIZE_INDEX.upsert([
				{
					id: record.id.toString(),
					values: embedding,
				},
			]);
			console.log('[rag-workflow] inserted vector for record:', record.id);
			return result;
		});
	}
}
