# Custom Analytics Platform -- ClickHouse Schema

Database: **analytics**

This schema models a web analytics platform that tracks user interactions,
session aggregates, user profiles, and a product catalog.  It is designed to
exercise the full range of ClickHouse-specific column types including UUID,
DateTime64, Enum8, Map, Array, LowCardinality, Nullable, and Decimal.

---

## Table: analytics.events

Clickstream events capturing every user interaction on the platform. This is the
highest-volume table and is partitioned by month for efficient time-range scans.

| Column | Type | Description |
|--------|------|-------------|
| event_id | UUID | Unique identifier for each event, auto-generated via generateUUIDv4() |
| session_id | String | Session identifier linking events within a single user visit |
| user_id | Nullable(UInt64) | Foreign key to users.user_id; NULL for anonymous visitors |
| event_type | Enum8('page_view'=1, 'click'=2, 'purchase'=3, 'signup'=4, 'logout'=5) | Category of the user interaction |
| page_url | String | Full URL of the page where the event occurred |
| referrer | String | HTTP referrer URL; empty string when direct traffic |
| device_type | LowCardinality(String) | Device category (e.g., desktop, mobile, tablet) |
| browser | LowCardinality(String) | Browser name (e.g., Chrome, Firefox, Safari) |
| os | LowCardinality(String) | Operating system (e.g., Windows, macOS, Linux, iOS, Android) |
| country | LowCardinality(String) | ISO 3166-1 alpha-2 country code of the visitor |
| city | String | City name derived from IP geolocation; may be empty |
| properties | Map(String, String) | Arbitrary key-value metadata attached to the event (e.g., button_id, page_section, product_id) |
| timestamp | DateTime64(3) | Event timestamp with millisecond precision |
| duration_ms | UInt32 | Time in milliseconds the user spent on the page before this event |
| is_bounce | UInt8 | 1 if this was the only event in the session, 0 otherwise |

**Engine:** MergeTree()
**ORDER BY:** (event_type, timestamp)
**PARTITION BY:** toYYYYMM(timestamp)

---

## Table: analytics.users

Registered user profiles including subscription plan, tags, lifetime value, and
preference settings.

| Column | Type | Description |
|--------|------|-------------|
| user_id | UInt64 | Unique numeric identifier for the user |
| email | String | User email address |
| name | String | Full display name |
| signup_date | Date | Calendar date when the user created their account |
| plan | Enum8('free'=1, 'starter'=2, 'pro'=3, 'enterprise'=4) | Current subscription tier |
| country | LowCardinality(String) | ISO 3166-1 alpha-2 country code |
| tags | Array(String) | Free-form labels applied to the user (e.g., premium, early_adopter, newsletter) |
| lifetime_value | Decimal(12, 2) | Total revenue attributed to this user in USD |
| last_active | DateTime | Timestamp of the user's most recent activity |
| preferences | Map(String, String) | User preference settings as key-value pairs (e.g., theme, language, timezone) |

**Engine:** MergeTree()
**ORDER BY:** user_id

---

## Table: analytics.sessions

Aggregated session records derived from raw clickstream events.  Each row
represents a contiguous browsing session from a single device.

| Column | Type | Description |
|--------|------|-------------|
| session_id | String | Unique session identifier (typically a UUID string) |
| user_id | Nullable(UInt64) | Foreign key to users.user_id; NULL for anonymous sessions |
| start_time | DateTime64(3) | Timestamp when the session began, millisecond precision |
| end_time | Nullable(DateTime64(3)) | Timestamp when the session ended; NULL if the session is still active or unknown |
| duration_seconds | UInt32 | Total session duration in seconds |
| page_count | UInt16 | Number of distinct pages viewed during the session |
| device_type | LowCardinality(String) | Device category (desktop, mobile, tablet) |
| browser | LowCardinality(String) | Browser name |
| os | LowCardinality(String) | Operating system |
| country | LowCardinality(String) | ISO 3166-1 alpha-2 country code |
| entry_page | String | URL of the first page visited in the session |
| exit_page | String | URL of the last page visited; empty string if same as entry |
| utm_source | Nullable(String) | UTM source parameter from the landing URL; NULL when absent |
| utm_medium | Nullable(String) | UTM medium parameter; NULL when absent |
| utm_campaign | Nullable(String) | UTM campaign parameter; NULL when absent |
| is_converted | UInt8 | 1 if the session included a purchase event, 0 otherwise |

**Engine:** MergeTree()
**ORDER BY:** (start_time, session_id)

---

## Table: analytics.products

Product catalog referenced by purchase events.  Includes pricing, categorization,
ratings, and free-form tags.

| Column | Type | Description |
|--------|------|-------------|
| product_id | UInt64 | Unique numeric product identifier |
| name | String | Product display name |
| category | LowCardinality(String) | Top-level product category (e.g., Electronics, Clothing, Books) |
| subcategory | LowCardinality(String) | Finer-grained product subcategory (e.g., Smartphones, Jackets) |
| price | Decimal(10, 2) | Unit price in USD |
| tags | Array(String) | Descriptive tags for search and filtering (e.g., bestseller, new_arrival, sale) |
| created_at | DateTime | Timestamp when the product was added to the catalog |
| is_active | UInt8 | 1 if the product is currently available for sale, 0 if delisted |
| rating | Float32 | Average customer rating on a 0.0 to 5.0 scale |
| review_count | UInt32 | Total number of customer reviews |

**Engine:** MergeTree()
**ORDER BY:** product_id
