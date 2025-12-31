# **Design Document: HTTP Routing**

## **1. Overview**

This design targets a HTTP routing subsystem in a high-performance service where:

* The **control plane** builds a static routing table (with dynamic placeholders like /users/{id}).
* The **data plane** only performs **read-only route lookup** at runtime.
* We avoid runtime deserialization or dynamic database access.
* Routing metadata (handler IDs, parameter names, etc.) is embedded in a **position-independent file** that can be **memory-mapped** (mmap). Memory mapping allows the OS to load only used pages and eliminates manual read I/O. 

This document covers:

* Radix tree on-disk layout
* Lookup procedure
* Rust mmap integration
* Safety/performance considerations

All memory access is designed to be **offset-based (no pointers)** so that the mmapped file is safe to reuse directly.


## **2. Radix Tree File Layout**

### **High-Level Structure**

```
+----------------------------+  
| File Header                |  
+----------------------------+  
| Node Array (fixed records) |  
+----------------------------+  
| Child Lists (buffers)      |  
+----------------------------+  
| String Pool                |  
+----------------------------+  
| Handler Metadata Pool      |  
+----------------------------+
```

The idea is that everything referenced is by **file offset**, allowing **position-independent access** when the file is mmapped.


### **2.1 File Header**

Stores metadata needed to interpret the mmapped file:

```rust
struct FileHeader {  
    magic: [u8; 6],         // b"LTBase"  
    version: u16,  
    root_node_off: u64,     // file offset for root node  
    node_count: u32,  
    string_pool_off: u64,  
    string_pool_len: u32,  
    handler_pool_off: u64,  // offset to handler metadata  
    handler_pool_len: u32,  
}
```

* `root_node_off` is where the traversal starts.
* `string_pool` and `handler_pool` hold text and handler info respectively.


### **2.2 Node Record (Fixed Size)**

Each node represents a compressed prefix and links to child list:

```rust
struct NodeRecord {  
    prefix_off: u32, // offset in string pool  
    prefix_len: u16, // length  
    flags: u8,       // e.g., is_param, has_handler  
    child_count: u8,  
    children_off: u64, // offset to child list  
    handler_off: u32,  // offset to handler pool (0 = none)  
}
```

**Flags** bits:

* Parameter node (is_param)
* Static path node
* Terminal (has handler)

Using u64 for offsets ensures files can grow large without 32-bit limits.


### **2.3 Child List**

Each node points to a child list buffer:
```rust
struct ChildEntry {  
    seg_type: u8,   // 0 = static, 1 = param  
    text_off: u32,  // literal segment text offset  
    text_len: u16,  
    node_off: u64,  // offset to NodeRecord  
}
```

The list layout is:

```
+-----------------------------+
| u8 child_count              |  ← Number of child records
+-----------------------------+
| ChildEntry #0               |  ← child_count ≥ 1
+-----------------------------+
| ChildEntry #1               |
+-----------------------------+
| ChildEntry #2               |
+-----------------------------+
| ...                         |
+-----------------------------+
| ChildEntry #(count-1)       |
+-----------------------------+
```

**Lookup order** at runtime:

1. Try static children (exact match)
2. Then try parameter children

This implements typical HTTP route matching strategies (static > dynamic).


### **2.4 String Pool**

All literal prefixes and segment labels are stored contiguously here to save space and avoid duplication. The router stores offsets into this pool.


### **2.5 Handler Pool**

Contains serialized metadata for matched handlers:

Examples of metadata:

* Handler ID
* Function pointer ID
* Permissions
* Middleware indices

It’s up to control plane to decide what you include, but items are referenced by `handler_off`.


## **3. Route Lookup Procedure**

Given a URL path like:

`/categories/100/products/abc`

1. **Split path into segments** by `/` to `["categories", "100", "products", "abc"]`

2. **Start at root node** using `root_node_off`

3. **Iterate Levels**

    For each segment:

   * Read the child list at `children_off`
   * Match static child by comparing `text_off/text_len`
   * If none, then parameter child
   * Record parameter value if `seg_type == parameter`

4. **Final Node**

    If `handler_off` is non-zero:
   * Extract handler metadata
   * Return matched handler and parameter map

This lookup is **O(L)** where `L` is number of segments, independent of number of routes because of prefix compression. 


## **4. Rust + mmap Integration**

### **4.1 Memory Mapping in Rust**

Rust crates like [memmap2](https://docs.rs/memmap2/latest/memmap2/) provide corss platform bindings for memory mapped buffers :

```rust
use memmap2::MmapOptions;  
use std::fs::File;

let f = File::open("routes.rtm")?;  
let mmap = unsafe { MmapOptions::new().map(&f)? };
```

This results in a `&[u8]` slice representing the full file. 

**Safety note:**

Memory mapping is unsafe because Rust cannot guarantee immutability if the file gets modified externally. But for read-only static files in production, it is safe with careful handling. 


### **4.2 Safe Access Patterns**

You typically wrap the raw `&[u8]` inside helper types that interpret offsets safely. For example:

```rust
fn read_node(mmap: &[u8], off: usize) -> &NodeRecord {  
    unsafe { &*(mmap.as_ptr().add(off) as *const NodeRecord) }  
}
```

Avoid direct &str from slice—use validated slices and convert to String safely.


### **4.3 Matching Example (Simplified)**

```rust
fn match_route(mmap: &[u8], segments: &[&str]) -> Option<MatchResult> {  
    let header = read_header(mmap);  
    let mut node_off = header.root_node_off as usize;  
    let mut params = HashMap::new();

    for seg in segments {  
        let node = read_node(mmap, node_off);  
        let children = read_children(mmap, node.children_off as usize);

        if let Some(child_static) = find_static(&children, seg, mmap) {  
            node_off = child_static.node_off as usize;  
            continue;  
        }  
        if let Some(child_param) = find_param(&children) {  
            params.insert(child_param.param_name.clone(), seg.to_string());  
            node_off = child_param.node_off as usize;  
            continue;  
        }  
        return None;  
    }

    let node = read_node(mmap, node_off);  
    if node.handler_off \!= 0 {  
        return Some(extract_handler(mmap, node.handler_off as usize, params));  
    }  
    None  
}
```

In this code, every access is just memory reads over mmapped data.


## **5. Performance & Safety Notes**

### **Performance**

* **Demand paging:** OS lazily loads pages on first access. 
* **No heap allocations:** All traversal reads from the mmapped region.
* **Shared pages:** Multiple processes mapping the same file share physical pages.


### **Safety**

Using `mmap` in Rust is inherently unsafe if interpreted as normal references, because Rust’s borrow checker cannot guarantee immutability or alignment from raw bytes. Recommended practice is:

* Use unsafe blocks in limited, audited helper functions
* Do not expose raw pointers widely
* Keep the mmapped slice alive as long as interpretations remain valid

These patterns are common in tools like [*fst*](https://github.com/BurntSushi/fst/) that do direct indexing on mmapped compressed data. 

## **6. Control Plane Build Process**

**Control plane responsibilities:**

1. Parse route patterns
2. Build a Radix tree in memory
3. Serialize:

   * Nodes
   * Child lists
   * String pool
   * Handler metadata

4. Write to file with a known header
5. Upload/distribute file to data plane


## **7. Summary**

This design achieves:

* **Zero deserialization at runtime**
* **High performance route matching (O(L))**
* **Efficient memory use via prefix compression**
* **No dependency on runtime databases**

It leverages:

* **Radix tree structure** (compressed prefix tree) for fast lookup and space efficiency. 
* **mmap memory mapping** to treat the on-disk layout as directly traversable in memory. 
* **Rust integration** with controlled unsafe for interpreting bytes as structures.


##  **8. Appendix**

### 8.1 Full File Layout

```
+======================== FILE HEADER ========================+
| magic                                                       |
| version                                                     |
| root_node_offset                                            |
| node_count                                                  |
| string_pool_offset                                          |
| string_pool_len                                             |
| handler_pool_offset                                         |
| handler_pool_len                                            |
+=============================================================+

+======================= NODE RECORDS ========================+
| NodeRecord 0                                                |
+-------------------------------------------------------------+
| NodeRecord 1                                                |
+-------------------------------------------------------------+
| ...                                                         |
+=============================================================+

+===================== CHILD LIST BUFFERS ====================+
|           (Child List #1)                                   |
|           +-----------------------------+                   |
|           | u8 child_count              |                   |
|           +-----------------------------+                   |
|           | ChildEntry #0               |                   |
|           +-----------------------------+                   |
|           | ChildEntry #1               |                   |
|           +-----------------------------+                   |
|           | ChildEntry #2               |                   |
|           +-----------------------------+                   |
|           | ...                         |                   |
|           +-----------------------------+                   |
|           | ChildEntry #N               |                   |
|           +-----------------------------+                   |
+-------------------------------------------------------------+
|           (Child List #2)                                   |
|           ...                                               |
+-------------------------------------------------------------+
| ...                                                         |
+=============================================================+

+======================= STRING POOL =========================+
| "categories"                                                |
+-------------------------------------------------------------+
| "products"                                                  |
+-------------------------------------------------------------+
| "{category_id}"                                             |
+-------------------------------------------------------------+
| ...                                                         |
+=============================================================+

+==================== HANDLER METADATA POOL ==================+
| HandlerMeta #0 (JSON string)                                |
+-------------------------------------------------------------+
| HandlerMeta #1 (JSON string)                                |
+-------------------------------------------------------------+
| ...                                                         |
+=============================================================+

```