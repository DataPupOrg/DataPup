#!/usr/bin/env python3
"""
Synthetic data generator for the DataPup VLDB benchmark -- Custom Analytics schema.

Generates realistic, correlated data for the four analytics tables (products,
users, sessions, events) and bulk-inserts it into ClickHouse via clickhouse-connect.

Usage:
    python generate_data.py                          # defaults
    python generate_data.py --scale 2.0              # double the row counts
    python generate_data.py --host 10.0.0.5 --port 8123 --scale 0.1

Dependencies:
    pip install faker clickhouse-connect tqdm
"""

from __future__ import annotations

import argparse
import logging
import math
import random
import sys
import uuid
from datetime import datetime, timedelta, date
from decimal import Decimal
from typing import Any, Sequence

from faker import Faker
from tqdm import tqdm

try:
    import clickhouse_connect
    from clickhouse_connect.driver.client import Client
except ImportError:
    clickhouse_connect = None  # type: ignore[assignment]

# ---------------------------------------------------------------------------
# Constants & configuration
# ---------------------------------------------------------------------------

LOG = logging.getLogger("generate_data")

# Base row counts (before scale factor)
BASE_PRODUCTS = 1_000
BASE_USERS = 10_000
BASE_SESSIONS = 100_000
BASE_EVENTS = 500_000

# Time range for generated data
START_DATE = datetime(2023, 1, 1)
END_DATE = datetime(2024, 12, 31, 23, 59, 59)
TOTAL_SECONDS = int((END_DATE - START_DATE).total_seconds())

BATCH_SIZE = 10_000

# Event-type distribution: 60% page_view, 25% click, 10% purchase, 3% signup, 2% logout
EVENT_TYPE_WEIGHTS = {
    "page_view": 60,
    "click": 25,
    "purchase": 10,
    "signup": 3,
    "logout": 2,
}
EVENT_TYPES = list(EVENT_TYPE_WEIGHTS.keys())
EVENT_TYPE_CUM_WEIGHTS: list[int] = []
_cum = 0
for _w in EVENT_TYPE_WEIGHTS.values():
    _cum += _w
    EVENT_TYPE_CUM_WEIGHTS.append(_cum)

# Plan distribution
PLAN_WEIGHTS = {"free": 50, "starter": 25, "pro": 15, "enterprise": 10}
PLANS = list(PLAN_WEIGHTS.keys())
PLAN_CUM_WEIGHTS: list[int] = []
_cum = 0
for _w in PLAN_WEIGHTS.values():
    _cum += _w
    PLAN_CUM_WEIGHTS.append(_cum)

# Device/browser/os pools
DEVICES = ["desktop", "mobile", "tablet"]
DEVICE_WEIGHTS = [55, 35, 10]

BROWSERS = ["Chrome", "Firefox", "Safari", "Edge", "Opera", "Samsung Internet"]
BROWSER_WEIGHTS = [50, 15, 20, 8, 4, 3]

OPERATING_SYSTEMS = ["Windows", "macOS", "Linux", "iOS", "Android", "ChromeOS"]
OS_WEIGHTS = [35, 20, 5, 20, 18, 2]

# Countries (top-20 by web traffic, simplified)
COUNTRIES = [
    "US", "IN", "BR", "ID", "RU", "JP", "DE", "GB", "FR", "MX",
    "NG", "KR", "TR", "CA", "AU", "IT", "ES", "PH", "VN", "TH",
]
COUNTRY_WEIGHTS = [
    25, 12, 8, 6, 5, 5, 4, 4, 3, 3,
    3, 3, 2, 2, 2, 2, 2, 2, 2, 2,
]

# UTM sources / media / campaigns
UTM_SOURCES = ["google", "facebook", "twitter", "linkedin", "email", "bing", "reddit", "tiktok"]
UTM_MEDIA = ["cpc", "organic", "social", "email", "referral", "display"]
UTM_CAMPAIGNS = [
    "spring_sale", "summer_launch", "black_friday", "holiday_2023",
    "new_year_2024", "product_launch", "retargeting_q1", "brand_awareness",
    "webinar_series", "newsletter_jan", "newsletter_feb", "newsletter_mar",
]

# Product categories/subcategories
PRODUCT_CATEGORIES: dict[str, list[str]] = {
    "Electronics":   ["Smartphones", "Laptops", "Tablets", "Headphones", "Cameras", "Smartwatches"],
    "Clothing":      ["T-Shirts", "Jeans", "Jackets", "Dresses", "Shoes", "Activewear"],
    "Home & Garden": ["Furniture", "Kitchen", "Bedding", "Lighting", "Decor", "Tools"],
    "Books":         ["Fiction", "Non-Fiction", "Science", "Biography", "Self-Help", "Children"],
    "Sports":        ["Running", "Cycling", "Gym Equipment", "Outdoor", "Yoga", "Swimming"],
    "Beauty":        ["Skincare", "Makeup", "Haircare", "Fragrance", "Bath & Body", "Nail Care"],
    "Toys & Games":  ["Board Games", "Puzzles", "Action Figures", "Educational", "Dolls", "Video Games"],
    "Food & Drink":  ["Coffee", "Tea", "Snacks", "Supplements", "Gourmet", "Organic"],
}

PRODUCT_TAGS_POOL = [
    "bestseller", "new_arrival", "sale", "limited_edition", "eco_friendly",
    "premium", "budget", "trending", "editor_choice", "top_rated",
    "clearance", "exclusive", "gift_idea", "seasonal", "bulk_deal",
]

USER_TAGS_POOL = [
    "premium", "early_adopter", "newsletter", "beta_tester", "power_user",
    "influencer", "referrer", "churned", "reactivated", "vip",
    "enterprise_lead", "trial_user", "mobile_only", "desktop_only", "multi_device",
]

# Page URL templates
PAGE_PATHS = [
    "/", "/pricing", "/features", "/about", "/blog", "/contact",
    "/docs", "/docs/getting-started", "/docs/api-reference", "/docs/faq",
    "/blog/post-{n}", "/products", "/products/{cat}", "/products/{cat}/{sub}",
    "/cart", "/checkout", "/account", "/account/settings", "/account/billing",
    "/search?q={q}",
]

SEARCH_QUERIES = [
    "analytics", "dashboard", "reporting", "integration", "pricing",
    "api", "webhook", "export", "csv", "real-time",
]

REFERRERS = [
    "", "", "", "",  # 40% direct (empty referrer)
    "https://www.google.com/", "https://www.google.com/",
    "https://www.google.com/",  # 30% Google
    "https://www.facebook.com/", "https://t.co/abc123",
    "https://www.linkedin.com/", "https://www.reddit.com/r/datascience",
    "https://news.ycombinator.com/", "https://www.bing.com/",
    "https://duckduckgo.com/",
]

# Preference keys / values
PREF_KEYS = {
    "theme":       ["light", "dark", "auto"],
    "language":    ["en", "es", "fr", "de", "ja", "pt", "zh"],
    "timezone":    ["America/New_York", "America/Los_Angeles", "Europe/London",
                    "Europe/Berlin", "Asia/Tokyo", "Asia/Shanghai", "America/Sao_Paulo"],
    "email_digest": ["daily", "weekly", "monthly", "none"],
    "currency":    ["USD", "EUR", "GBP", "JPY", "BRL", "INR"],
}

# Event properties templates by event type
EVENT_PROPERTIES_TEMPLATES: dict[str, list[dict[str, list[str]]]] = {
    "page_view": [
        {"page_section": ["header", "hero", "body", "footer", "sidebar"]},
        {"scroll_depth": ["25", "50", "75", "100"]},
        {"load_time_ms": ["120", "250", "450", "800", "1200", "2500"]},
    ],
    "click": [
        {"button_id": ["cta_1", "cta_2", "nav_menu", "search_btn", "login_btn",
                        "signup_btn", "add_to_cart", "learn_more", "download", "share"]},
        {"page_section": ["header", "hero", "body", "footer", "sidebar", "modal"]},
        {"element_type": ["button", "link", "image", "card", "dropdown"]},
    ],
    "purchase": [
        {"payment_method": ["credit_card", "paypal", "apple_pay", "google_pay", "bank_transfer"]},
        {"currency": ["USD", "EUR", "GBP", "JPY", "BRL"]},
        {"coupon_code": ["SAVE10", "WELCOME20", "SUMMER15", "LOYALTY5", ""]},
    ],
    "signup": [
        {"signup_method": ["email", "google", "github", "apple", "facebook"]},
        {"referral_source": ["organic", "paid", "referral", "social", "email"]},
    ],
    "logout": [
        {"logout_reason": ["manual", "timeout", "session_expired", "forced"]},
    ],
}

fake = Faker()
Faker.seed(42)
random.seed(42)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def weighted_choice(population: Sequence[str], cum_weights: Sequence[int]) -> str:
    """Fast weighted random choice using cumulative weights."""
    r = random.randint(1, cum_weights[-1])
    for item, cw in zip(population, cum_weights):
        if r <= cw:
            return item
    return population[-1]  # fallback


def random_timestamp(start: datetime = START_DATE, end: datetime = END_DATE) -> datetime:
    """Return a random datetime between start and end with ms precision."""
    delta_s = int((end - start).total_seconds())
    offset_ms = random.randint(0, max(delta_s * 1000, 1))
    return start + timedelta(milliseconds=offset_ms)


def generate_page_url(product_ids: list[int] | None = None) -> str:
    """Generate a realistic page URL."""
    path = random.choice(PAGE_PATHS)
    if "{n}" in path:
        path = path.replace("{n}", str(random.randint(1, 200)))
    if "{cat}" in path:
        cat = random.choice(list(PRODUCT_CATEGORIES.keys()))
        path = path.replace("{cat}", cat.lower().replace(" & ", "-").replace(" ", "-"))
        if "{sub}" in path:
            sub = random.choice(PRODUCT_CATEGORIES[cat])
            path = path.replace("{sub}", sub.lower().replace(" ", "-"))
    if "{q}" in path:
        path = path.replace("{q}", random.choice(SEARCH_QUERIES))
    return f"https://example.com{path}"


def generate_event_properties(event_type: str, product_ids: list[int] | None = None) -> dict[str, str]:
    """Build a realistic properties map for a given event type."""
    templates = EVENT_PROPERTIES_TEMPLATES.get(event_type, [])
    props: dict[str, str] = {}
    # Pick 1-3 property groups
    n = min(len(templates), random.randint(1, 3))
    chosen = random.sample(templates, n)
    for tpl in chosen:
        for key, values in tpl.items():
            props[key] = random.choice(values)
    # Add product_id and quantity for purchases
    if event_type == "purchase" and product_ids:
        props["product_id"] = str(random.choice(product_ids))
        props["quantity"] = str(random.randint(1, 5))
        props["amount"] = f"{random.uniform(5.0, 500.0):.2f}"
    return props


def generate_user_preferences() -> dict[str, str]:
    """Generate a realistic user preferences map."""
    prefs: dict[str, str] = {}
    # Each user gets 2-5 preference keys
    keys = random.sample(list(PREF_KEYS.keys()), k=random.randint(2, min(5, len(PREF_KEYS))))
    for key in keys:
        prefs[key] = random.choice(PREF_KEYS[key])
    return prefs


# ---------------------------------------------------------------------------
# Data generators
# ---------------------------------------------------------------------------

def generate_products(n: int) -> list[dict[str, Any]]:
    """Generate n product records."""
    LOG.info("Generating %d products ...", n)
    rows: list[dict[str, Any]] = []
    categories = list(PRODUCT_CATEGORIES.keys())
    for pid in tqdm(range(1, n + 1), desc="products", unit="row"):
        cat = random.choice(categories)
        sub = random.choice(PRODUCT_CATEGORIES[cat])
        tag_count = random.randint(1, 5)
        tags = random.sample(PRODUCT_TAGS_POOL, k=min(tag_count, len(PRODUCT_TAGS_POOL)))
        rating = round(random.uniform(1.0, 5.0), 1) if random.random() > 0.05 else 0.0
        rows.append({
            "product_id":   pid,
            "name":         fake.catch_phrase(),
            "category":     cat,
            "subcategory":  sub,
            "price":        Decimal(f"{random.uniform(4.99, 999.99):.2f}"),
            "tags":         tags,
            "created_at":   random_timestamp(),
            "is_active":    1 if random.random() > 0.08 else 0,
            "rating":       float(rating),
            "review_count": random.randint(0, 5000) if rating > 0 else 0,
        })
    return rows


def generate_users(n: int) -> list[dict[str, Any]]:
    """Generate n user records."""
    LOG.info("Generating %d users ...", n)
    rows: list[dict[str, Any]] = []
    for uid in tqdm(range(1, n + 1), desc="users", unit="row"):
        signup = fake.date_between(start_date=START_DATE.date(), end_date=END_DATE.date())
        plan = weighted_choice(PLANS, PLAN_CUM_WEIGHTS)
        # Lifetime value correlates with plan
        ltv_base = {"free": 0, "starter": 50, "pro": 200, "enterprise": 1000}[plan]
        ltv = Decimal(f"{max(0, ltv_base + random.gauss(0, ltv_base * 0.5)):.2f}")
        tag_count = random.randint(0, 4)
        tags = random.sample(USER_TAGS_POOL, k=min(tag_count, len(USER_TAGS_POOL)))
        country = random.choices(COUNTRIES, weights=COUNTRY_WEIGHTS, k=1)[0]
        last_active_dt = random_timestamp(
            start=datetime.combine(signup, datetime.min.time()),
            end=END_DATE,
        )
        rows.append({
            "user_id":        uid,
            "email":          fake.unique.email(),
            "name":           fake.name(),
            "signup_date":    signup,
            "plan":           plan,
            "country":        country,
            "tags":           tags,
            "lifetime_value": ltv,
            "last_active":    last_active_dt,
            "preferences":    generate_user_preferences(),
        })
    return rows


def generate_sessions(
    n: int,
    user_ids: list[int],
) -> list[dict[str, Any]]:
    """Generate n session records referencing existing user IDs."""
    LOG.info("Generating %d sessions ...", n)
    rows: list[dict[str, Any]] = []
    for _ in tqdm(range(n), desc="sessions", unit="row"):
        sid = str(uuid.uuid4())
        # ~70% of sessions are from registered users
        uid: int | None = random.choice(user_ids) if random.random() < 0.70 else None
        start = random_timestamp()
        duration = int(random.expovariate(1.0 / 300))  # mean 300s
        duration = min(duration, 7200)  # cap at 2h
        end = start + timedelta(seconds=duration)
        page_count = max(1, int(random.expovariate(1.0 / 5)))  # mean 5
        page_count = min(page_count, 50)

        device = random.choices(DEVICES, weights=DEVICE_WEIGHTS, k=1)[0]
        browser = random.choices(BROWSERS, weights=BROWSER_WEIGHTS, k=1)[0]
        os_ = random.choices(OPERATING_SYSTEMS, weights=OS_WEIGHTS, k=1)[0]
        country = random.choices(COUNTRIES, weights=COUNTRY_WEIGHTS, k=1)[0]

        entry_page = generate_page_url()
        exit_page = generate_page_url() if page_count > 1 else ""

        # ~30% of sessions have UTM parameters
        has_utm = random.random() < 0.30
        utm_source = random.choice(UTM_SOURCES) if has_utm else None
        utm_medium = random.choice(UTM_MEDIA) if has_utm else None
        utm_campaign = random.choice(UTM_CAMPAIGNS) if has_utm else None

        is_converted = 1 if random.random() < 0.08 else 0

        rows.append({
            "session_id":       sid,
            "user_id":          uid,
            "start_time":       start,
            "end_time":         end,
            "duration_seconds": duration,
            "page_count":       page_count,
            "device_type":      device,
            "browser":          browser,
            "os":               os_,
            "country":          country,
            "entry_page":       entry_page,
            "exit_page":        exit_page,
            "utm_source":       utm_source,
            "utm_medium":       utm_medium,
            "utm_campaign":     utm_campaign,
            "is_converted":     is_converted,
        })
    return rows


def generate_events(
    n: int,
    sessions: list[dict[str, Any]],
    product_ids: list[int],
) -> list[dict[str, Any]]:
    """Generate n event records referencing existing sessions."""
    LOG.info("Generating %d events ...", n)
    rows: list[dict[str, Any]] = []

    # Pre-compute session lookup for faster access
    session_count = len(sessions)

    for _ in tqdm(range(n), desc="events", unit="row"):
        # Pick a random session
        sess = sessions[random.randint(0, session_count - 1)]

        event_type = weighted_choice(EVENT_TYPES, EVENT_TYPE_CUM_WEIGHTS)

        # Timestamp falls within the session window
        sess_start = sess["start_time"]
        sess_end = sess["end_time"]
        if sess_end and sess_end > sess_start:
            offset_ms = random.randint(0, int((sess_end - sess_start).total_seconds() * 1000))
            ts = sess_start + timedelta(milliseconds=offset_ms)
        else:
            ts = sess_start

        page_url = generate_page_url(product_ids)
        referrer = random.choice(REFERRERS)
        properties = generate_event_properties(event_type, product_ids)
        duration_ms = random.randint(0, 120000) if event_type == "page_view" else random.randint(0, 5000)
        is_bounce = 1 if sess["page_count"] == 1 and random.random() < 0.8 else 0

        rows.append({
            "event_id":    str(uuid.uuid4()),
            "session_id":  sess["session_id"],
            "user_id":     sess["user_id"],
            "event_type":  event_type,
            "page_url":    page_url,
            "referrer":    referrer,
            "device_type": sess["device_type"],
            "browser":     sess["browser"],
            "os":          sess["os"],
            "country":     sess["country"],
            "city":        fake.city() if random.random() < 0.7 else "",
            "properties":  properties,
            "timestamp":   ts,
            "duration_ms": duration_ms,
            "is_bounce":   is_bounce,
        })

    return rows


# ---------------------------------------------------------------------------
# ClickHouse insertion
# ---------------------------------------------------------------------------

def get_client(host: str, port: int, username: str, password: str, secure: bool) -> "Client":
    """Create and return a clickhouse-connect client."""
    if clickhouse_connect is None:
        LOG.error("clickhouse-connect is not installed.  Run: pip install clickhouse-connect")
        sys.exit(1)
    return clickhouse_connect.get_client(
        host=host,
        port=port,
        username=username,
        password=password,
        secure=secure,
    )


def run_ddl(client: "Client", ddl_path: str) -> None:
    """Execute every statement in the DDL file."""
    with open(ddl_path, "r") as fh:
        ddl_text = fh.read()
    # Split on semicolons, skip empty / comment-only blocks
    for stmt in ddl_text.split(";"):
        stmt = stmt.strip()
        if not stmt or stmt.startswith("--"):
            continue
        # Skip pure comment blocks
        lines = [l for l in stmt.splitlines() if not l.strip().startswith("--")]
        if not "".join(lines).strip():
            continue
        LOG.info("Executing DDL: %s ...", stmt[:80].replace("\n", " "))
        client.command(stmt)


def insert_rows(
    client: "Client",
    table: str,
    columns: list[str],
    rows: list[dict[str, Any]],
    batch_size: int = BATCH_SIZE,
) -> None:
    """Batch-insert rows into a ClickHouse table."""
    total = len(rows)
    batches = math.ceil(total / batch_size)
    LOG.info("Inserting %d rows into %s in %d batches of %d ...", total, table, batches, batch_size)

    for i in tqdm(range(0, total, batch_size), desc=f"insert {table}", unit="batch"):
        batch = rows[i : i + batch_size]
        data = [[row[c] for c in columns] for row in batch]
        client.insert(table, data, column_names=columns)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Generate synthetic data for the DataPup analytics benchmark.",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    p.add_argument("--host", default="localhost", help="ClickHouse server host")
    p.add_argument("--port", type=int, default=8123, help="ClickHouse HTTP port")
    p.add_argument("--username", default="default", help="ClickHouse username")
    p.add_argument("--password", default="", help="ClickHouse password")
    p.add_argument("--secure", action="store_true", help="Use HTTPS for the connection")
    p.add_argument(
        "--scale", type=float, default=1.0,
        help="Scale factor applied to all row counts (e.g., 0.1 for quick tests, 2.0 for stress tests)",
    )
    p.add_argument("--batch-size", type=int, default=BATCH_SIZE, help="Rows per INSERT batch")
    p.add_argument(
        "--ddl-path", default=None,
        help="Path to the DDL SQL file.  If provided, tables are created before loading data.",
    )
    p.add_argument("--skip-insert", action="store_true", help="Generate data but do not insert into ClickHouse")
    p.add_argument("--seed", type=int, default=42, help="Random seed for reproducibility")
    p.add_argument("-v", "--verbose", action="store_true", help="Enable debug logging")
    return p.parse_args()


def main() -> None:
    args = parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )

    # Seed
    random.seed(args.seed)
    Faker.seed(args.seed)

    # Compute scaled row counts
    n_products = max(1, int(BASE_PRODUCTS * args.scale))
    n_users    = max(1, int(BASE_USERS * args.scale))
    n_sessions = max(1, int(BASE_SESSIONS * args.scale))
    n_events   = max(1, int(BASE_EVENTS * args.scale))

    LOG.info(
        "Row counts (scale=%.2f): products=%d, users=%d, sessions=%d, events=%d",
        args.scale, n_products, n_users, n_sessions, n_events,
    )

    # ------------------------------------------------------------------
    # Phase 1: Generate data
    # ------------------------------------------------------------------
    products = generate_products(n_products)
    product_ids = [p["product_id"] for p in products]

    users = generate_users(n_users)
    user_ids = [u["user_id"] for u in users]

    sessions = generate_sessions(n_sessions, user_ids)
    events = generate_events(n_events, sessions, product_ids)

    if args.skip_insert:
        LOG.info("--skip-insert set.  Data generated but not inserted.")
        LOG.info("  products : %d rows", len(products))
        LOG.info("  users    : %d rows", len(users))
        LOG.info("  sessions : %d rows", len(sessions))
        LOG.info("  events   : %d rows", len(events))
        return

    # ------------------------------------------------------------------
    # Phase 2: Insert into ClickHouse
    # ------------------------------------------------------------------
    client = get_client(args.host, args.port, args.username, args.password, args.secure)

    # Optionally run DDL
    if args.ddl_path:
        run_ddl(client, args.ddl_path)

    # Products
    insert_rows(
        client, "analytics.products",
        ["product_id", "name", "category", "subcategory", "price",
         "tags", "created_at", "is_active", "rating", "review_count"],
        products,
        batch_size=args.batch_size,
    )

    # Users
    insert_rows(
        client, "analytics.users",
        ["user_id", "email", "name", "signup_date", "plan", "country",
         "tags", "lifetime_value", "last_active", "preferences"],
        users,
        batch_size=args.batch_size,
    )

    # Sessions
    insert_rows(
        client, "analytics.sessions",
        ["session_id", "user_id", "start_time", "end_time",
         "duration_seconds", "page_count", "device_type", "browser", "os",
         "country", "entry_page", "exit_page",
         "utm_source", "utm_medium", "utm_campaign", "is_converted"],
        sessions,
        batch_size=args.batch_size,
    )

    # Events
    insert_rows(
        client, "analytics.events",
        ["event_id", "session_id", "user_id", "event_type", "page_url",
         "referrer", "device_type", "browser", "os", "country", "city",
         "properties", "timestamp", "duration_ms", "is_bounce"],
        events,
        batch_size=args.batch_size,
    )

    LOG.info("All data inserted successfully.")
    LOG.info(
        "Final counts: products=%d, users=%d, sessions=%d, events=%d",
        len(products), len(users), len(sessions), len(events),
    )


if __name__ == "__main__":
    main()
