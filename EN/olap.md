# **Technical Specification: OLAP and Advanced Search Architecture**

Context: Scaling an EAV-based system for high-performance OLAP and Advanced Search.

## **1. Executive Summary**

LTBase utilizes an EAV (Entity-Attribute-Value) design. While efficient for OLTP scenarios with flexible schemas, EAV models perform poorly (30x slower than wide tables in parquet or worse) for cross-entity joins in analytical contexts.

This specification defines a **Real-Time Lakehouse Architecture**. Data is synchronized from the OLTP database to an S3 Data Lake (Parquet) via CDC. The system employs **DuckDB** as a federated query engine to merge historical data (S3) with real-time buffers (Postgres), providing sub-second freshness without heavy ETL latency.

# **2. System Architecture**

The architecture decouples storage (S3) from compute (DuckDB) while bridging the latency gap using the OLTP database as a hot buffer.

### **High-Level Data Flow**

1. **OLTP Layer (Hot):** Application writes to Postgres. A `change_log` table captures changes within the transaction.  
2. **Ingestion Layer (Warm):** A CDC Worker monitors the log and performs **"Smart Flushing"** to write Delta files to S3.  
3. **Storage Layer (Cold):** S3 stores data in a **"Base + Delta"** format, optimized for DuckDB/Athena.
4. **Query Layer (Federated):** DuckDB executes a **Merge-on-Read** query across S3 files and the Postgres buffer.

## **3. CDC & Data Ingestion**

### **3.1 change_log Table (Real-Time Buffer)**

This table serves dual purposes: a buffer for S3 flushing and a source for real-time queries.

| Field      | Type     | Description                                          |
| :--------- | :------- | :--------------------------------------------------- |
| time_slot  | BIGINT   | Unix timestamp (ms). **Must be strictly monotonic.** |
| schema_id  | SMALLINT | ID of the entity schema.                             |
| row_id     | UUID     | UUID v7.                                             |
| deleted_at | BIGINT   | Soft delete timestamp. 0 or NULL indicates Active.   |

### **3.2 Ingestion Strategy: Smart Flushing**

To eliminate the "Small File Problem" on S3, strictly timed syncs are replaced by adaptive flushing. It utilizes **DuckDB's postgres extension** to read data from Postgres and write data to parquet.

* **Trigger Logic:** Flush data to S3 only when:  
  * **Record Count:** Accumulated Records > **20,000**.  
  * **Time:** Oldest un-synced record > **1 Hour**.  
* **Action:** Write a **Delta File (Level 0)** to S3 and remove flushed rows from the change_log (or mark as flushed).

## **4. Storage Layer (S3)**

We utilize **Hive-style partitioning** to enable efficient partition pruning.

* **Path:** s3://<bucket_for_client>/<project_id>/<schema_id>/<uuid_v7>.parquet  
* **Format:** Parquet (ZSTD Compression).

### **4.1 File Classification**

1. **Base Files (Stable):**  
   * **Size:** ~256 MB.  
   * **Content:** Historical, sorted, deduplicated.  
   * **Key Trait:** Covers a fixed, immutable row_id range.  
2. **Delta Files (Volatile):**  
   * **Size:** 10 MB - 50 MB.  
   * **Content:** Recent inserts and updates.

## **5. Maintenance: Targeted Compaction**

To minimize Write Amplification, we employ a **Hybrid Copy-on-Write** strategy leveraging **UUID v7 locality**.

### **5.1 Compaction Logic**

A daily background worker processes Delta files:

#### **Phase 1: New Data (Append)**

* **Scenario:** New `row_ids` (time-ordered) are greater than existing Base Files.  
* **Action:**:
  * 1. Create **NEW** base file (file name: `present_<schema_id>.parquet`) if it doesn't exist yet.
  * 2. Batch these into **NEW** Base Files. No historical files are touched.

#### **Phase 2: Historical Updates (Targeted Patching)**

* **Scenario:** Updates to old row_ids fall into existing Base File ranges.  
* **Action:**  
  1. **Locate:** Use Parquet Metadata (Min/Max) to find the specific Base File.  
  2. **Evaluate:** Calculate the **Dirty Ratio** (% of rows updated).  
  3. **Decision:**  
     * **Ratio < 5%:** **Skip Rewrite.** Keep updates in Delta files.  
     * **Ratio > 5%:** **Trigger Rewrite.** Merge Base + Delta in memory and overwrite the Base File (Atomic Swap).

#### **Phase 3: Move New Data file to Historical Data file**

* **Scenario:** New data file is greater than 256MB after compaction.
* **Action:**  
  1. **Move:** Move the new data file to `<min_row_id>_<max_row_id>.parquet`


## **6. Query Layer: Real-Time Federated Query**

Advanced Search utilizes **DuckDB's postgres extension** to unify S3 and Postgres.

### **6.1 Unified View Logic**

The query constructs a virtual view merging three data tiers.

**SQL Template:**

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

