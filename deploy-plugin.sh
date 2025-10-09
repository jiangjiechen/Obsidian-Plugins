#!/usr/bin/env bash
set -euo pipefail

if [ $# -lt 2 ]; then
  echo "Usage: $0 <plugin-directory> <path-to-.obsidian>" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_NAME="$1"
TARGET_OBSIDIAN_DIR="$2"

PLUGIN_DIR="${SCRIPT_DIR}/${PLUGIN_NAME}"
if [ ! -d "${PLUGIN_DIR}" ]; then
  echo "Plugin directory not found: ${PLUGIN_DIR}" >&2
  exit 2
fi

if [ ! -f "${PLUGIN_DIR}/manifest.json" ]; then
  echo "manifest.json not found in plugin directory: ${PLUGIN_DIR}" >&2
  exit 3
fi

if [ ! -d "${TARGET_OBSIDIAN_DIR}" ]; then
  echo "Target .obsidian directory not found: ${TARGET_OBSIDIAN_DIR}" >&2
  exit 4
fi

echo "Building plugin '${PLUGIN_NAME}'..."
(cd "${PLUGIN_DIR}" && npm run build)

PLUGIN_ID="$(node -p "(() => { try { return require(process.argv[1]).id || ''; } catch (e) { return ''; } })()" "${PLUGIN_DIR}/manifest.json" 2>/dev/null)"
if [ -z "${PLUGIN_ID}" ]; then
  PLUGIN_ID="${PLUGIN_NAME##*/}"
  echo "Warning: Unable to read plugin id from manifest.json, defaulting to directory name '${PLUGIN_ID}'." >&2
fi

DEST_DIR="${TARGET_OBSIDIAN_DIR}/plugins/${PLUGIN_ID}"
mkdir -p "${DEST_DIR}"

echo "Copying build artifacts to ${DEST_DIR}"
for file in main.js main.js.map manifest.json styles.css; do
  if [ -f "${PLUGIN_DIR}/${file}" ]; then
    cp "${PLUGIN_DIR}/${file}" "${DEST_DIR}/${file}"
  fi
done

echo "Deployment complete."
