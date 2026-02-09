#!/usr/bin/env bash
# load_clickbench.sh -- Download and load ClickBench hits table into local ClickHouse
#
# Prerequisites:
#   - ClickHouse server running locally (port 9000 native, 8123 HTTP)
#   - clickhouse-client installed
#   - ~15GB free disk space for compressed data, ~70GB for uncompressed
#
# Usage:
#   bash evaluation/load_clickbench.sh
#   bash evaluation/load_clickbench.sh --skip-download  # if data already downloaded

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
DATA_DIR="${PROJECT_ROOT}/clickhouse/data/clickbench"
CLICKHOUSE_CLIENT="${CLICKHOUSE_CLIENT:-clickhouse-client}"
CLICKHOUSE_HOST="${CLICKHOUSE_HOST:-localhost}"
CLICKHOUSE_PORT="${CLICKHOUSE_PORT:-9000}"

SKIP_DOWNLOAD=false
if [[ "${1:-}" == "--skip-download" ]]; then
    SKIP_DOWNLOAD=true
fi

echo "============================================================"
echo "  ClickBench Data Loader"
echo "  Target: ${CLICKHOUSE_HOST}:${CLICKHOUSE_PORT}"
echo "============================================================"

# Step 1: Create table
echo ""
echo "[1/3] Creating hits table..."
${CLICKHOUSE_CLIENT} --host "${CLICKHOUSE_HOST}" --port "${CLICKHOUSE_PORT}" \
    --multiquery < "${SCRIPT_DIR}/benchmark/schemas/clickbench/schema_ddl.sql"
echo "  Table created."

# Step 2: Download data (if needed)
mkdir -p "${DATA_DIR}"
HITS_FILE="${DATA_DIR}/hits.tsv.gz"

if [[ "$SKIP_DOWNLOAD" == false ]] && [[ ! -f "$HITS_FILE" ]]; then
    echo ""
    echo "[2/3] Downloading ClickBench data (~15GB compressed)..."
    echo "  This may take a while depending on your connection speed."
    curl -L --progress-bar \
        "https://datasets.clickhouse.com/hits_compatible/hits.tsv.gz" \
        -o "${HITS_FILE}"
    echo "  Download complete: $(du -h "${HITS_FILE}" | cut -f1)"
elif [[ -f "$HITS_FILE" ]]; then
    echo ""
    echo "[2/3] Data file already exists: $(du -h "${HITS_FILE}" | cut -f1)"
else
    echo ""
    echo "[2/3] Skipping download (--skip-download flag)"
fi

# Step 3: Load data
echo ""
echo "[3/3] Loading data into ClickHouse..."
echo "  This may take 10-30 minutes depending on hardware."

if [[ -f "$HITS_FILE" ]]; then
    gunzip -c "${HITS_FILE}" | ${CLICKHOUSE_CLIENT} \
        --host "${CLICKHOUSE_HOST}" --port "${CLICKHOUSE_PORT}" \
        --query "INSERT INTO default.hits FORMAT TSV" \
        --max_insert_block_size=100000
fi

# Verify
ROW_COUNT=$(${CLICKHOUSE_CLIENT} --host "${CLICKHOUSE_HOST}" --port "${CLICKHOUSE_PORT}" \
    --query "SELECT count() FROM default.hits")
echo ""
echo "============================================================"
echo "  ClickBench loaded successfully!"
echo "  Rows: ${ROW_COUNT}"
echo "============================================================"
