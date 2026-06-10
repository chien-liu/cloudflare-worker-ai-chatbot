# RAG Notes Management

This project keeps RAG source notes in the local `notes/` directory and syncs them into the Worker-backed D1 + Vectorize store.

## Architecture diagram

![Architecture and workflow diagram](docs/architecture-workflow.svg)

## Cloudflare deployment

- This repository is integrated with Cloudflare Workers.
- The deployed Worker is built from the code in `src/`, with `src/worker.js` as the entrypoint.
- The production route is `https://api.chienliu.com/chatbot`.
- The local maintenance assets in `notes/` and `scripts/` support RAG content management, but they are not the Worker code that gets deployed from `src/`.
- In practice: when you change the application logic that should run in production, update `src/`; when you manage local RAG content, work in `notes/` and use the sync script in `scripts/`.

## How it works

- Each markdown file in `notes/` is the source of truth for one RAG note.
- The filename must follow this format:

```text
${id}_${name_for_human_editor}.md
```

Examples:

```text
1_chiens_work_experience.md
2_projects.md
15_publications.md
```

- `${id}` must be a positive integer.
- The sync script normalizes the filename ID before sending it to the API.
- The resulting ID is reused as the note ID in D1 and Vectorize.
- Remote note writes happen through `PUT /notes/:id` with a JSON body shaped like `{ "text": "..." }`.
- Renaming or deleting local files affects remote data on the next sync.

## Daily workflow

1. Create or edit markdown files in `notes/`.
2. Start the local Worker:

```bash
npx wrangler dev
```

3. In another terminal, run the sync:

```bash
npm run sync:notes
```
The workflow may take a moment to process. Monitor the `npx wrangler dev` output to confirm the upload has completed.

## Sync behavior

The sync script is `scripts/sync-rag-notes.sh`.

It will:

1. Scan `notes/` for `*.md` files.
2. Validate that every filename matches `${id}_*.md`.
3. Compute a SHA-256 hash for each file.
4. Upload only notes whose content changed since the last successful sync.
5. Delete remote notes whose IDs existed in the previous sync state but no longer exist locally.
6. Save sync state in `.rag-sync-state`.

Because of this behavior:

- Editing a file updates the remote note
- Adding a file creates a remote note
- Deleting a file deletes the remote note
- Changing only the human-readable suffix keeps the same remote note if the numeric ID stays the same

## Troubleshooting

- `Missing auth token`: export `WRITE_API_TOKEN`.
- `Notes directory not found`: create `notes/` or set `RAG_SYNC_NOTES_DIR`.
- `Invalid note filename`: rename the file to `${id}_name.md`.
- `Duplicate note id`: ensure only one markdown file uses each numeric ID.

## Notes on safety

`wrangler dev` in this project is configured with remote Cloudflare bindings. A live sync updates the bound D1 and Vectorize resources, so use the sync flow carefully.
