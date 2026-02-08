-- =============================================================================
-- DataPup VLDB Benchmark: Custom Analytics Platform Schema
-- =============================================================================
-- ClickHouse DDL for a realistic web analytics platform.
-- Exercises advanced ClickHouse types: UUID, DateTime64, Enum8, Map, Array,
-- LowCardinality, Nullable, Decimal, and multiple MergeTree configurations.
-- =============================================================================

CREATE DATABASE IF NOT EXISTS analytics;

-- ---------------------------------------------------------------------------
-- Table 1: events
-- ---------------------------------------------------------------------------
-- Clickstream events capturing every user interaction on the platform.
-- Designed to be the highest-volume table (~500K rows in benchmark).
-- Uses Map(String, String) for flexible event properties, Enum8 for the
-- fixed set of event types, and DateTime64(3) for millisecond precision.
-- Partitioned by month for time-range query acceleration.
-- ---------------------------------------------------------------------------
CREATE TABLE analytics.events
(
    event_id     UUID                   DEFAULT generateUUIDv4(),
    session_id   String,
    user_id      Nullable(UInt64),
    event_type   Enum8(
                     'page_view' = 1,
                     'click'     = 2,
                     'purchase'  = 3,
                     'signup'    = 4,
                     'logout'    = 5
                 ),
    page_url     String,
    referrer     String                 DEFAULT '',
    device_type  LowCardinality(String),
    browser      LowCardinality(String),
    os           LowCardinality(String),
    country      LowCardinality(String),
    city         String                 DEFAULT '',
    properties   Map(String, String),
    timestamp    DateTime64(3),
    duration_ms  UInt32                 DEFAULT 0,
    is_bounce    UInt8                  DEFAULT 0
)
ENGINE = MergeTree()
ORDER BY (event_type, timestamp)
PARTITION BY toYYYYMM(timestamp);

-- ---------------------------------------------------------------------------
-- Table 2: users
-- ---------------------------------------------------------------------------
-- Registered user profiles.  Contains Array(String) for free-form tags,
-- Map(String, String) for user preferences, and Decimal(12, 2) for monetary
-- lifetime value.  Ordered by user_id for point-lookup efficiency.
-- ---------------------------------------------------------------------------
CREATE TABLE analytics.users
(
    user_id        UInt64,
    email          String,
    name           String,
    signup_date    Date,
    plan           Enum8(
                       'free'       = 1,
                       'starter'    = 2,
                       'pro'        = 3,
                       'enterprise' = 4
                   ),
    country        LowCardinality(String),
    tags           Array(String),
    lifetime_value Decimal(12, 2)       DEFAULT 0,
    last_active    DateTime,
    preferences    Map(String, String)
)
ENGINE = MergeTree()
ORDER BY user_id;

-- ---------------------------------------------------------------------------
-- Table 3: sessions
-- ---------------------------------------------------------------------------
-- Aggregated session records derived from raw events.  Nullable fields for
-- UTM parameters reflect their optional nature.  Ordered by start_time for
-- efficient time-range scans.
-- ---------------------------------------------------------------------------
CREATE TABLE analytics.sessions
(
    session_id       String,
    user_id          Nullable(UInt64),
    start_time       DateTime64(3),
    end_time         Nullable(DateTime64(3)),
    duration_seconds UInt32                  DEFAULT 0,
    page_count       UInt16                  DEFAULT 1,
    device_type      LowCardinality(String),
    browser          LowCardinality(String),
    os               LowCardinality(String),
    country          LowCardinality(String),
    entry_page       String,
    exit_page        String                  DEFAULT '',
    utm_source       Nullable(String),
    utm_medium       Nullable(String),
    utm_campaign     Nullable(String),
    is_converted     UInt8                   DEFAULT 0
)
ENGINE = MergeTree()
ORDER BY (start_time, session_id);

-- ---------------------------------------------------------------------------
-- Table 4: products
-- ---------------------------------------------------------------------------
-- Product catalog used in purchase events.  Array(String) holds product tags,
-- Float32 for average rating, and Decimal(10, 2) for price.
-- ---------------------------------------------------------------------------
CREATE TABLE analytics.products
(
    product_id   UInt64,
    name         String,
    category     LowCardinality(String),
    subcategory  LowCardinality(String),
    price        Decimal(10, 2),
    tags         Array(String),
    created_at   DateTime,
    is_active    UInt8                  DEFAULT 1,
    rating       Float32                DEFAULT 0,
    review_count UInt32                 DEFAULT 0
)
ENGINE = MergeTree()
ORDER BY product_id;
