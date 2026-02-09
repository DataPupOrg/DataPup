# Star Schema Benchmark (SSB) - Schema Documentation

The Star Schema Benchmark (SSB) is a variation of TPC-H designed specifically for star schema
data warehouse workloads. It consists of one central fact table (**lineorder**) and four
dimension tables (**customer**, **supplier**, **part**, **dates**).

---

## Schema Diagram

```
                    ┌──────────────┐
                    │   customer   │
                    │──────────────│
                    │ C_CUSTKEY    │◄──┐
                    │ C_NAME       │   │
                    │ C_ADDRESS    │   │
                    │ C_CITY       │   │
                    │ C_NATION     │   │
                    │ C_REGION     │   │
                    │ C_PHONE      │   │
                    │ C_MKTSEGMENT │   │
                    └──────────────┘   │
                                       │
┌──────────────┐   ┌──────────────────┐│  ┌──────────────┐
│   supplier   │   │    lineorder     ││  │     part     │
│──────────────│   │──────────────────││  │──────────────│
│ S_SUPPKEY    │◄──│ LO_ORDERKEY      ││  │ P_PARTKEY    │◄┐
│ S_NAME       │   │ LO_LINENUMBER    ││  │ P_NAME       │ │
│ S_ADDRESS    │   │ LO_CUSTKEY     ──┘│  │ P_MFGR       │ │
│ S_CITY       │   │ LO_PARTKEY     ───┼─►│ P_CATEGORY   │ │
│ S_NATION     │   │ LO_SUPPKEY     ───┘  │ P_BRAND      │ │
│ S_REGION     │   │ LO_ORDERDATE   ──┐   │ P_COLOR      │ │
│ S_PHONE      │   │ LO_ORDERPRIORITY ││  │ P_TYPE       │ │
└──────────────┘   │ LO_SHIPPRIORITY  ││  │ P_SIZE       │ │
                    │ LO_QUANTITY      ││  │ P_CONTAINER  │ │
                    │ LO_EXTENDEDPRICE ││  └──────────────┘ │
                    │ LO_ORDTOTALPRICE ││                    │
                    │ LO_DISCOUNT      ││                    │
                    │ LO_REVENUE       ││                    │
                    │ LO_SUPPLYCOST    ││                    │
                    │ LO_TAX           ││                    │
                    │ LO_COMMITDATE    ││                    │
                    │ LO_SHIPMODE      ││                    │
                    └──────────────────┘│                    │
                                        │                    │
                    ┌──────────────────┐│                    │
                    │      dates       ││                    │
                    │──────────────────││                    │
                    │ D_DATEKEY        │◄┘                   │
                    │ D_DATE           │                     │
                    │ D_DAYOFWEEK      │                     │
                    │ D_MONTH          │                     │
                    │ D_YEAR           │                     │
                    │ D_YEARMONTHNUM   │                     │
                    │ D_YEARMONTH      │                     │
                    │ D_DAYNUMINWEEK   │                     │
                    │ D_DAYNUMINMONTH  │                     │
                    │ D_DAYNUMINYEAR   │                     │
                    │ D_MONTHNUMINYEAR │                     │
                    │ D_WEEKNUMINYEAR  │                     │
                    │ D_SELLINGSEASON  │                     │
                    │ D_LASTDAYINWEEKFL│                     │
                    │ D_LASTDAYINMONTHFL                     │
                    │ D_HOLIDAYFL      │                     │
                    │ D_WEEKDAYFL      │                     │
                    └──────────────────┘                     │
```

---

## Fact Table

### lineorder

Central fact table containing order line items. Each row represents a single line item within
an order. Contains foreign keys to all four dimension tables and measures for revenue analysis.

**Row count:** ~600,037,902 (Scale Factor 100)
**Engine:** MergeTree

| Column | Type | Description |
|--------|------|-------------|
| `LO_ORDERKEY` | UInt32 | Order key identifier |
| `LO_LINENUMBER` | UInt8 | Line item number within order |
| `LO_CUSTKEY` | UInt32 | Customer key (FK to customer.C_CUSTKEY) |
| `LO_PARTKEY` | UInt32 | Part key (FK to part.P_PARTKEY) |
| `LO_SUPPKEY` | UInt32 | Supplier key (FK to supplier.S_SUPPKEY) |
| `LO_ORDERDATE` | Date | Order date (FK to dates.D_DATEKEY) |
| `LO_ORDERPRIORITY` | LowCardinality(String) | Order priority (1-URGENT, 2-HIGH, 3-MEDIUM, 4-NOT SPECIFIED, 5-LOW) |
| `LO_SHIPPRIORITY` | UInt8 | Shipping priority |
| `LO_QUANTITY` | UInt8 | Order quantity |
| `LO_EXTENDEDPRICE` | UInt32 | Extended price (cents) |
| `LO_ORDTOTALPRICE` | UInt32 | Total order price (cents) |
| `LO_DISCOUNT` | UInt8 | Discount percentage (0-10) |
| `LO_REVENUE` | UInt32 | Revenue = extendedprice * (1 - discount/100) |
| `LO_SUPPLYCOST` | UInt32 | Supply cost (cents) |
| `LO_TAX` | UInt8 | Tax percentage |
| `LO_COMMITDATE` | Date | Commit (promised delivery) date |
| `LO_SHIPMODE` | LowCardinality(String) | Shipping mode (AIR, SHIP, TRUCK, RAIL, etc.) |

---

## Dimension Tables

### customer

Customer dimension table with geographic hierarchy and market segment classification.

**Row count:** ~3,000,000 (Scale Factor 100)
**Engine:** MergeTree

| Column | Type | Description |
|--------|------|-------------|
| `C_CUSTKEY` | UInt32 | Customer key (primary key) |
| `C_NAME` | String | Customer name |
| `C_ADDRESS` | String | Customer address |
| `C_CITY` | LowCardinality(String) | Customer city |
| `C_NATION` | LowCardinality(String) | Customer nation |
| `C_REGION` | LowCardinality(String) | Customer region (AMERICA, ASIA, EUROPE, MIDDLE EAST, AFRICA) |
| `C_PHONE` | String | Customer phone number |
| `C_MKTSEGMENT` | LowCardinality(String) | Market segment (AUTOMOBILE, BUILDING, FURNITURE, HOUSEHOLD, MACHINERY) |

**Geographic Hierarchy:** City -> Nation -> Region

---

### supplier

Supplier dimension table with geographic hierarchy information.

**Row count:** ~200,000 (Scale Factor 100)
**Engine:** MergeTree

| Column | Type | Description |
|--------|------|-------------|
| `S_SUPPKEY` | UInt32 | Supplier key (primary key) |
| `S_NAME` | String | Supplier name |
| `S_ADDRESS` | String | Supplier address |
| `S_CITY` | LowCardinality(String) | Supplier city |
| `S_NATION` | LowCardinality(String) | Supplier nation |
| `S_REGION` | LowCardinality(String) | Supplier region |
| `S_PHONE` | String | Supplier phone number |

**Geographic Hierarchy:** City -> Nation -> Region

---

### part

Part/product dimension table with category hierarchy and brand information.

**Row count:** ~1,400,000 (Scale Factor 100)
**Engine:** MergeTree

| Column | Type | Description |
|--------|------|-------------|
| `P_PARTKEY` | UInt32 | Part key (primary key) |
| `P_NAME` | String | Part name |
| `P_MFGR` | LowCardinality(String) | Manufacturer (MFGR#1 through MFGR#5) |
| `P_CATEGORY` | LowCardinality(String) | Category (MFGR#1#1 through MFGR#5#5) |
| `P_BRAND` | LowCardinality(String) | Brand (MFGR#1#1#1 through MFGR#5#5#40) |
| `P_COLOR` | LowCardinality(String) | Part color |
| `P_TYPE` | LowCardinality(String) | Part type |
| `P_SIZE` | UInt8 | Part size (1-50) |
| `P_CONTAINER` | LowCardinality(String) | Container type |

**Category Hierarchy:** Manufacturer -> Category -> Brand

---

### dates

Date/calendar dimension table providing various temporal attributes for time-based analysis.

**Row count:** 2,556 (7 years of dates)
**Engine:** MergeTree

| Column | Type | Description |
|--------|------|-------------|
| `D_DATEKEY` | Date | Date key (primary key, YYYY-MM-DD) |
| `D_DATE` | String | Full date string |
| `D_DAYOFWEEK` | LowCardinality(String) | Day of week name |
| `D_MONTH` | LowCardinality(String) | Month name |
| `D_YEAR` | UInt16 | Calendar year |
| `D_YEARMONTHNUM` | UInt32 | Year-month as number (YYYYMM) |
| `D_YEARMONTH` | LowCardinality(String) | Year-month string |
| `D_DAYNUMINWEEK` | UInt8 | Day number in week (1-7) |
| `D_DAYNUMINMONTH` | UInt8 | Day number in month (1-31) |
| `D_DAYNUMINYEAR` | UInt16 | Day number in year (1-366) |
| `D_MONTHNUMINYEAR` | UInt8 | Month number (1-12) |
| `D_WEEKNUMINYEAR` | UInt8 | Week number in year |
| `D_SELLINGSEASON` | String | Selling season description |
| `D_LASTDAYINWEEKFL` | UInt8 | Last day in week flag (0/1) |
| `D_LASTDAYINMONTHFL` | UInt8 | Last day in month flag (0/1) |
| `D_HOLIDAYFL` | UInt8 | Holiday flag (0/1) |
| `D_WEEKDAYFL` | UInt8 | Weekday flag (0/1) |

---

## Relationships (Foreign Keys)

| From (Fact Table) | To (Dimension Table) | Join Condition |
|---|---|---|
| `lineorder.LO_CUSTKEY` | `customer.C_CUSTKEY` | `LO_CUSTKEY = C_CUSTKEY` |
| `lineorder.LO_SUPPKEY` | `supplier.S_SUPPKEY` | `LO_SUPPKEY = S_SUPPKEY` |
| `lineorder.LO_PARTKEY` | `part.P_PARTKEY` | `LO_PARTKEY = P_PARTKEY` |
| `lineorder.LO_ORDERDATE` | `dates.D_DATEKEY` | `LO_ORDERDATE = D_DATEKEY` |

---

## Query Flights

The SSB defines 13 queries organized into 4 query flights:

- **Q1 (Filter):** Revenue aggregation with varying filter selectivity on the fact table
- **Q2 (Part/Supplier):** Revenue grouped by year and brand, filtering by region and part attributes
- **Q3 (Customer/Supplier):** Revenue grouped by customer/supplier geography and year
- **Q4 (Profit):** Profit analysis combining all dimensions with complex filters
