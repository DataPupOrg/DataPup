-- Star Schema Benchmark (SSB) DDL for ClickHouse
-- Database: ssb
-- Schema: 1 fact table (lineorder) + 4 dimension tables (customer, supplier, part, dates)

CREATE DATABASE IF NOT EXISTS ssb;

-- =============================================================================
-- Fact Table: lineorder
-- =============================================================================
-- Central fact table containing order line items with foreign keys to all
-- dimension tables. Each row represents a single line item in an order.
-- Scale Factor 100: ~600 million rows.
-- =============================================================================

CREATE TABLE IF NOT EXISTS ssb.lineorder
(
    LO_ORDERKEY       UInt32,
    LO_LINENUMBER     UInt8,
    LO_CUSTKEY        UInt32,
    LO_PARTKEY        UInt32,
    LO_SUPPKEY        UInt32,
    LO_ORDERDATE      Date,
    LO_ORDERPRIORITY  LowCardinality(String),
    LO_SHIPPRIORITY   UInt8,
    LO_QUANTITY       UInt8,
    LO_EXTENDEDPRICE  UInt32,
    LO_ORDTOTALPRICE  UInt32,
    LO_DISCOUNT       UInt8,
    LO_REVENUE        UInt32,
    LO_SUPPLYCOST     UInt32,
    LO_TAX            UInt8,
    LO_COMMITDATE     Date,
    LO_SHIPMODE       LowCardinality(String)
)
ENGINE = MergeTree
ORDER BY (LO_ORDERDATE, LO_ORDERKEY);

-- =============================================================================
-- Dimension Table: customer
-- =============================================================================
-- Customer dimension with geographic hierarchy: city -> nation -> region.
-- Also includes market segment classification.
-- Scale Factor 100: ~3 million rows.
-- =============================================================================

CREATE TABLE IF NOT EXISTS ssb.customer
(
    C_CUSTKEY     UInt32,
    C_NAME        String,
    C_ADDRESS     String,
    C_CITY        LowCardinality(String),
    C_NATION      LowCardinality(String),
    C_REGION      LowCardinality(String),
    C_PHONE       String,
    C_MKTSEGMENT  LowCardinality(String)
)
ENGINE = MergeTree
ORDER BY (C_CUSTKEY);

-- =============================================================================
-- Dimension Table: supplier
-- =============================================================================
-- Supplier dimension with geographic hierarchy: city -> nation -> region.
-- Scale Factor 100: ~200,000 rows.
-- =============================================================================

CREATE TABLE IF NOT EXISTS ssb.supplier
(
    S_SUPPKEY  UInt32,
    S_NAME     String,
    S_ADDRESS  String,
    S_CITY     LowCardinality(String),
    S_NATION   LowCardinality(String),
    S_REGION   LowCardinality(String),
    S_PHONE    String
)
ENGINE = MergeTree
ORDER BY (S_SUPPKEY);

-- =============================================================================
-- Dimension Table: part
-- =============================================================================
-- Part/product dimension with category hierarchy: manufacturer -> category -> brand.
-- Scale Factor 100: ~1.4 million rows.
-- =============================================================================

CREATE TABLE IF NOT EXISTS ssb.part
(
    P_PARTKEY    UInt32,
    P_NAME       String,
    P_MFGR       LowCardinality(String),
    P_CATEGORY   LowCardinality(String),
    P_BRAND      LowCardinality(String),
    P_COLOR      LowCardinality(String),
    P_TYPE       LowCardinality(String),
    P_SIZE       UInt8,
    P_CONTAINER  LowCardinality(String)
)
ENGINE = MergeTree
ORDER BY (P_PARTKEY);

-- =============================================================================
-- Dimension Table: dates
-- =============================================================================
-- Date/calendar dimension with various temporal attributes for time-based
-- analysis. Covers 7 years of dates (~2,556 rows).
-- =============================================================================

CREATE TABLE IF NOT EXISTS ssb.dates
(
    D_DATEKEY         Date,
    D_DATE            String,
    D_DAYOFWEEK       LowCardinality(String),
    D_MONTH           LowCardinality(String),
    D_YEAR            UInt16,
    D_YEARMONTHNUM    UInt32,
    D_YEARMONTH       LowCardinality(String),
    D_DAYNUMINWEEK    UInt8,
    D_DAYNUMINMONTH   UInt8,
    D_DAYNUMINYEAR    UInt16,
    D_MONTHNUMINYEAR  UInt8,
    D_WEEKNUMINYEAR   UInt8,
    D_SELLINGSEASON   String,
    D_LASTDAYINWEEKFL  UInt8,
    D_LASTDAYINMONTHFL UInt8,
    D_HOLIDAYFL       UInt8,
    D_WEEKDAYFL       UInt8
)
ENGINE = MergeTree
ORDER BY (D_DATEKEY);
