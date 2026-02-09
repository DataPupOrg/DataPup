#!/usr/bin/env bash
# load_ssb.sh -- Generate and load Star Schema Benchmark (SSB) data into ClickHouse
#
# Prerequisites:
#   - ClickHouse server running locally
#   - clickhouse-client installed
#   - git (to clone ssb-dbgen)
#   - gcc/make (to compile dbgen)
#   - ~6GB free disk space
#
# Usage:
#   bash evaluation/load_ssb.sh
#   bash evaluation/load_ssb.sh --scale-factor 10  # default: 10 (~600M rows)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
DATA_DIR="${PROJECT_ROOT}/clickhouse/data/ssb"
CLICKHOUSE_CLIENT="${CLICKHOUSE_CLIENT:-clickhouse-client}"
CLICKHOUSE_HOST="${CLICKHOUSE_HOST:-localhost}"
CLICKHOUSE_PORT="${CLICKHOUSE_PORT:-9000}"
SCALE_FACTOR="${2:-10}"

if [[ "${1:-}" == "--scale-factor" ]]; then
    SCALE_FACTOR="${2:-10}"
fi

echo "============================================================"
echo "  SSB Data Loader (Scale Factor: ${SCALE_FACTOR})"
echo "  Target: ${CLICKHOUSE_HOST}:${CLICKHOUSE_PORT}"
echo "============================================================"

# Step 1: Create database and tables
echo ""
echo "[1/5] Creating SSB database and tables..."
${CLICKHOUSE_CLIENT} --host "${CLICKHOUSE_HOST}" --port "${CLICKHOUSE_PORT}" \
    --multiquery < "${SCRIPT_DIR}/benchmark/schemas/ssb/schema_ddl.sql"
echo "  Tables created."

# Step 2: Clone and build ssb-dbgen
DBGEN_DIR="${DATA_DIR}/ssb-dbgen"
mkdir -p "${DATA_DIR}"

if [[ ! -d "${DBGEN_DIR}" ]]; then
    echo ""
    echo "[2/5] Cloning ssb-dbgen..."
    git clone https://github.com/eyalroz/ssb-dbgen.git "${DBGEN_DIR}"
fi

if [[ ! -f "${DBGEN_DIR}/dbgen" ]]; then
    echo ""
    echo "[3/5] Building dbgen..."
    cd "${DBGEN_DIR}"
    cmake . && make
    cd "${PROJECT_ROOT}"
fi

# Step 3: Generate data
echo ""
echo "[3/5] Generating SSB data (SF=${SCALE_FACTOR})..."
cd "${DBGEN_DIR}"
./dbgen -s "${SCALE_FACTOR}" -T a
cd "${PROJECT_ROOT}"

# Step 4: Load data into ClickHouse
echo ""
echo "[4/5] Loading data into ClickHouse..."

for table in customer part supplier dates lineorder; do
    file_map_customer="customer.tbl"
    file_map_part="part.tbl"
    file_map_supplier="supplier.tbl"
    file_map_dates="date.tbl"
    file_map_lineorder="lineorder.tbl"
    
    eval "DATA_FILE=\${DBGEN_DIR}/\${file_map_${table}}"
    
    if [[ -f "${DATA_FILE}" ]]; then
        echo "  Loading ${table}..."
        ${CLICKHOUSE_CLIENT} --host "${CLICKHOUSE_HOST}" --port "${CLICKHOUSE_PORT}" \
            --query "INSERT INTO ssb.${table} FORMAT CSV" \
            --format_csv_delimiter='|' \
            < "${DATA_FILE}"
    else
        echo "  WARNING: ${DATA_FILE} not found, skipping ${table}"
    fi
done

# Step 5: Verify
echo ""
echo "[5/5] Verifying..."
for table in customer part supplier dates lineorder; do
    COUNT=$(${CLICKHOUSE_CLIENT} --host "${CLICKHOUSE_HOST}" --port "${CLICKHOUSE_PORT}" \
        --query "SELECT count() FROM ssb.${table}" 2>/dev/null || echo "0")
    echo "  ssb.${table}: ${COUNT} rows"
done

echo ""
echo "============================================================"
echo "  SSB data loaded successfully!"
echo "============================================================"
