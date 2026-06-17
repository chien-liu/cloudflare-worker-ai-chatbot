#!/usr/bin/env bash
set -euo pipefail

# Sync markdown notes into the local Worker-backed RAG store.
# Usage:
#   1. npx wrangler dev
#   2. npm run sync:notes

SCRIPT_PATH=$(realpath "${BASH_SOURCE[0]}")
SCRIPT_DIR=$(dirname "$SCRIPT_PATH")
REPO_ROOT=$(dirname "$SCRIPT_DIR")

# Load environment variables from .env.local
. "$REPO_ROOT/.env.local"

NOTES_DIR="${REPO_ROOT}/notes"
STATE_FILE="${REPO_ROOT}/.rag-sync-state"
RAG_WORKER_URL=${RAG_WORKER_URL:-http://127.0.0.1:8787}


if [[ -z "$ADMIN_API_ENABLED" ]]; then
	echo 'Missing env variable: set ADMIN_API_ENABLED=true before running the sync script.' >&2
	exit 1
fi

if [[ ! -d "$NOTES_DIR" ]]; then
	echo "Notes directory not found: $NOTES_DIR" >&2
	exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
	echo 'curl is required to sync notes.' >&2
	exit 1
fi

if ! command -v sha256sum >/dev/null 2>&1; then
	echo 'sha256sum is required to sync notes.' >&2
	exit 1
fi

if ! command -v node >/dev/null 2>&1; then
	echo 'node is required to build JSON payloads for note sync.' >&2
	exit 1
fi

# Associative arrays to track note states. Keys are note IDs, values are hashes and paths.
declare -A previous_hash_by_id=()
declare -A previous_path_by_id=()
declare -A current_hash_by_id=()
declare -A current_path_by_id=()

# Validates and normalises a raw note ID string to a positive decimal integer.
normalize_note_id() {
	local raw_id="$1"
	local normalized

	# Ensure raw_id consists of digits only
	if [[ ! "$raw_id" =~ ^[0-9]+$ ]]; then
		return 1
	fi

	# Remove leading zeros
	normalized=$((10#$raw_id))
	if (( normalized < 1 )); then
		return 1
	fi

	printf '%s\n' "$normalized"
}

# Reads the state file and populates hash and path arrays.
load_previous_state() {
	if [[ ! -f "$STATE_FILE" ]]; then
		return
	fi

	while IFS=$'\t' read -r id hash path || [[ -n "${id:-}" ]]; do
		[[ -z "${id:-}" ]] && continue
		previous_hash_by_id["$id"]="$hash"
		previous_path_by_id["$id"]="$path"
	done < "$STATE_FILE"
}

# Strips the repo root prefix from an absolute path, returning a repo-relative path.
relative_to_repo() {
	local path="$1"
	printf '%s\n' "${path#"$REPO_ROOT"/}"
}

# Sends a PUT request to upsert a note file's content into the RAG store.
upload_note() {
	local note_id="$1"
	local file_path="$2"

	node --input-type=module -e "import { readFileSync } from 'node:fs'; process.stdout.write(JSON.stringify({ text: readFileSync(process.argv[1], 'utf8') }));" "$file_path" |
		curl --silent --show-error --fail-with-body \
			--request PUT \
			--header 'Content-Type: application/json' \
			--data-binary @- \
			"$RAG_WORKER_URL/notes/$note_id" >/dev/null
}

# Sends a DELETE request to remove a note by ID from the RAG store.
delete_note() {
	local note_id="$1"

	curl --silent --show-error --fail-with-body \
		--request DELETE \
		"$RAG_WORKER_URL/notes/$note_id" >/dev/null
}

# Atomically writes the current note hashes and paths to the state file.
write_current_state() {
	local state_dir
	local tmp_state

	state_dir=$(dirname -- "$STATE_FILE")
	mkdir -p "$state_dir"
	tmp_state=$(mktemp "$state_dir/.rag-sync-state.XXXXXX")
	trap 'rm -f "$tmp_state"' EXIT

	if ((${#current_hash_by_id[@]} > 0)); then
		while IFS= read -r note_id; do
			printf '%s\t%s\t%s\n' \
				"$note_id" \
				"${current_hash_by_id[$note_id]}" \
				"${current_path_by_id[$note_id]}"
		done < <(printf '%s\n' "${!current_hash_by_id[@]}" | sort -n) > "$tmp_state"
	else
		: > "$tmp_state"
	fi

	mv "$tmp_state" "$STATE_FILE"
	trap - EXIT
}

load_previous_state

uploaded_count=0
deleted_count=0
skipped_count=0

# Process each markdown file in the notes directory.
while IFS= read -r file_path; do
	file_name=$(basename -- "$file_path")

	if [[ ! "$file_name" =~ ^([0-9]+)_(.+)\.md$ ]]; then
		echo "Invalid note filename '$file_name'. Expected format: \${id}_name.md" >&2
		exit 1
	fi

	raw_id="${BASH_REMATCH[1]}"
	note_id=$(normalize_note_id "$raw_id") || {
		echo "Invalid note id in '$file_name'. IDs must be positive integers." >&2
		exit 1
	}

	if [[ -n "${current_hash_by_id[$note_id]+x}" ]]; then
		echo "Duplicate note id '$note_id' detected in notes directory." >&2
		exit 1
	fi

	note_hash=$(sha256sum "$file_path" | awk '{print $1}')
	note_path=$(relative_to_repo "$file_path")

	current_hash_by_id["$note_id"]="$note_hash"
	current_path_by_id["$note_id"]="$note_path"

	if [[ "${previous_hash_by_id[$note_id]-}" == "$note_hash" ]]; then
		echo "Skipping unchanged note $note_id ($note_path)"
		((skipped_count += 1))
		continue
	fi

	echo "Uploading note $note_id ($note_path)"
	upload_note "$note_id" "$file_path"
	((uploaded_count += 1))
done < <(find "$NOTES_DIR" -maxdepth 1 -type f -name '*.md' | LC_ALL=C sort)

# Delete notes that existed previously but are no longer present in the notes directory.
for note_id in "${!previous_hash_by_id[@]}"; do
	if [[ -n "${current_hash_by_id[$note_id]+x}" ]]; then
		continue
	fi

	echo "Deleting removed note $note_id (${previous_path_by_id[$note_id]})"
	delete_note "$note_id"
	((deleted_count += 1))
done

write_current_state

echo "RAG sync complete: uploaded=$uploaded_count skipped=$skipped_count deleted=$deleted_count"
