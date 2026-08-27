# Technical Specification: OLAP and Advanced Search Architecture

Context: Scaling an EAV-based system for high-performance OLAP and Advanced Search.

## 1. Executive Summary

LTBase uses an EAV (Entity-Attribute-Value) design. While efficient for OLTP scenarios with flexible schemas, EAV models perform poorly (30x slower than wide tables in parquet or worse) for cross-entity joins in analytical contexts.

This specification defines a real-time lakehouse architecture. Data is synchronized from the OLTP database to an S3 Data Lake (Parquet) via Change Data Capture (CDC). DuckDB is used as a federated query engine to merge historical data (S3) with real-time buffers (Postgres), giving sub-second freshness without heavy ETL latency.

# 2. System Architecture

The architecture decouples storage (S3) from compute (DuckDB) while bridging the latency gap using the OLTP database as a hot buffer.

### High-Level Data Flow

1. OLTP layer (hot): application writes to Postgres. A `change_log` table captures changes within the transaction.  
2. Ingestion layer (warm): a CDC Worker monitors the log and performs "Smart Flushing" to write Delta files to S3.  
3. Storage layer (cold): S3 stores data in a "Base + Delta" format, optimized for DuckDB/Athena.
4. Query layer (federated): DuckDB executes a Merge-on-Read query across S3 files and the Postgres buffer.

## 3. CDC & Data Ingestion

### 3.1 change_log Table (Real-Time Buffer)

This table has two purposes: a buffer for S3 flushing and a source for real-time queries.

| Field      | Type     | Description                                                                   |
| :--------- | :------- | :---------------------------------------------------------------------------- |
| changed_at | BIGINT   | Unix timestamp (ms).                                                          |
| schema_id  | SMALLINT | ID of the entity schema.                                                      |
| row_id     | UUID     | UUID v7.                                                                      |
| deleted_at | BIGINT   | Soft delete timestamp. 0 or NULL indicates Active.                            |
| flushed_at | BIGINT   | Unix timestamp (ms) when the record was flushed to S3. 0 indicates unflushed. |

* Primary Key: `(schema_id, row_id, flushed_at)` to allow multiple versions per row.

### 3.2 Ingestion Strategy: Smart Flushing

To eliminate the "Small File Problem" on S3, strictly timed syncs are replaced by adaptive flushing. It uses DuckDB's postgres extension to read data from Postgres and write data to parquet.

* Trigger logic: flush data to S3 only when:  
  * Record count: accumulated records > 20,000.  
  * Time: oldest un-synced record > 1 hour.  
* Action: write a Delta File (Level 0) to S3 and remove flushed rows from the change_log (or mark as flushed).

## 4. Storage Layer (S3)

Hive-style partitioning is used so that partitions can be pruned.

* Path: s3://<bucket_for_client>/<project_id>/<schema_id>/<uuid_v7>.parquet  
* Format: Parquet (ZSTD Compression).

### 4.1 File Classification

1. Base files (stable):  
   * Size: ~256 MB.  
   * Content: historical, sorted, deduplicated.  
   * Key trait: covers a fixed, immutable row_id range.  
2. Delta files (volatile):  
   * Size: 10 MB - 50 MB.  
   * Content: recent inserts and updates.

## 5. Maintenance: Targeted Compaction

To minimize Write Amplification, we use a Hybrid Copy-on-Write strategy based on UUID v7 locality.

### 5.1 Compaction Logic

A daily background worker processes Delta files:

#### Phase 1: New Data (Append)

* Scenario: new `row_ids` (time-ordered) are greater than existing Base Files.  
* Action:
  * 1. Create a NEW base file (file name: `present_<schema_id>.parquet`) if it doesn't exist yet.
  * 2. Batch these into NEW Base Files. No historical files are touched.

#### Phase 2: Historical Updates (Targeted Patching)

* Scenario: updates to old row_ids fall into existing Base File ranges.  
* Action:  
  1. Locate: use Parquet Metadata (Min/Max) to find the specific Base File.  
  2. Evaluate: calculate the Dirty Ratio (% of rows updated).  
  3. Decision:  
     * Ratio < 5%: skip rewrite. Keep updates in Delta files.  
     * Ratio > 5%: trigger rewrite. Merge Base + Delta in memory and overwrite the Base File (Atomic Swap).

#### Phase 3: Move New Data file to Historical Data file

* Scenario: new data file is greater than 256MB after compaction.
* Action:  
  1. Move: move the new data file to `<min_row_id>_<max_row_id>.parquet`


## 6. Query Layer: Real-Time Federated Query

Advanced Search uses DuckDB's postgres extension to unify S3 and Postgres.

### 6.1 Unified View Logic

The query constructs a virtual view merging three data tiers.

SQL template:

```SQL

SELECT * FROM (  
    -- Tier 1: S3 Base Files (Historical)  
    SELECT * FROM read_parquet('s3://.../Base/*.parquet') 
    WHERE __search_filter__

    UNION ALL

    -- Tier 2: S3 Delta Files (Recent Flushes)  
    SELECT * FROM read_parquet('s3://.../Delta/*.parquet') 
    WHERE __search_filter__

    UNION ALL

    -- Tier 3: Postgres Real-Time Buffer (Hot)  
    -- Directly scans OLTP for data not yet flushed to S3  
    SELECT time_slot, schema_id, row_id, deleted_at, ...   
    FROM postgres_scan('SELECT * FROM change_log WHERE time_slot > ...')  
    WHERE __search_filter__
)  
-- Step 2: Global Deduplication (Last Write Wins)  
QUALIFY ROW_NUMBER() OVER (PARTITION BY row_id ORDER BY time_slot DESC) = 1

-- Step 3: Filter Soft Deletes  
WHERE (deleted_at IS NULL OR deleted_at = 0);
```

