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

### **2.6 Method + First Segment Index**
To accelerate root matches (especially with many prefixes), include:

```rust
struct MethodPrefixIndexEntry {
    method: u8;             // HTTP method
    first_seg_off: u32;     // string pool offset for first segment
    first_seg_len: u16;
    node_off: u64;          // subtree start
}
```
This table appears right after the handler pool and enables a direct HashMap mapping from `(method, first segment) → node_off`. This avoids scanning the root node’s child list for high-fan-out cases.


## **3. Route Lookup Procedure**

Matching an input path `/categories/100/products/abc` involves:

1. **Split path into segments**: `["categories", "100", "products", "abc"]`
2. **Optional initial index lookup**:
   * Lookup `(method, segments[0])` in hashmap built from MethodPrefixIndex
   * If found, start at that node offset
   * Otherwise proceed with root node

3. **Traverse Radix Tree**:
    For each segment:
   * Read current node’s children\_off
   * Scan small child list:
     * Try static match first
     * Otherwise fall back to parameter child
   * Update current node offset

4. **Final node**:
   * Verify `handler_off` nonzero
   * Read metadata from handler pool

Radix Tree lookup time scales with **path length L**, not total route count N, even with 100,000 routes. Root fan-out may be large (~3000 prefixes), but scanning only at the first level costs little relative to full scan and can be eliminated with the prefix index optimization.

### **Time & Space Complexity**

| Operation       | Complexity                         |
| --------------- | ---------------------------------- |
| Lookup time     | O(L) where L = number of segments  |
| Memory overhead | Compact tree with shared prefixes  |
| Startup cost    | Single mmap + optional index build |

Even at large scale (100k routes), traversal is proportional to path depth, typically low (e.g., `/a/b/c` has `L=3`).

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

### Appendix A - Full File Layout

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
| method              // HTTP method                          |
| first_seg_off       // string pool offset for first segment |
| first_seg_len                                               |
| node_off            // subtree start                        |
+-------------------------------------------------------------+
| ...                                                         |
+=============================================================+

+============== Method+Prefix Index Region  ==================+
| HandlerMeta #0 (JSON string)                                |
+-------------------------------------------------------------+
| HandlerMeta #1 (JSON string)                                |
+-------------------------------------------------------------+
| ...                                                         |
+=============================================================+
```


## **Appendix B — Full Example of mmap File Layout with Method+First Segment Index**

This appendix shows a concrete **memory-mapped Radix Tree file layout** including offsets, child lists, string pool, handler pool, and Method + First Segment Index. It builds on the example routes:

```
GET /categories  
POST /categories/search
GET /categories/{cid}/products  
GET /categories/{cid}/products/{pid}

GET /domains  
GET /domains/{domain_name}

GET /users  
GET /users/{user_id}
```

The structure is organized so that the data plane can mmap this file and perform lookups without deserialization, using offset arithmetic and memory view access. 

### **B.1 Example mmap Layout (with illustrative offsets)**

File Offset  
```
0x0000 ─── File Header  
0x0040 ─── Method+FirstSegment Index Region  
0x0140 ─── NodeRecord 0 (root)  
0x0160 ─── NodeRecord 1 "/categories"  
0x0180 ─── NodeRecord 2 "/categories/search"  
0x01A0 ─── NodeRecord 3 "/categories/{cid}/products"  
0x01C0 ─── NodeRecord 4 "/categories/{cid}/products/{pid}"  
0x01E0 ─── NodeRecord 5 "/domains"  
0x0200 ─── NodeRecord 6 "/domains/{domain_name}"  
0x0220 ─── NodeRecord 7 "/users"  
0x0240 ─── NodeRecord 8 "/users/{user_id}"  
0x0260 ─── ChildList for Node 0  
0x0280 ─── ChildList for Node 1  
0x02A0 ─── ChildList for Node 3  
0x02C0 ─── ChildList for Node 5  
0x02E0 ─── ChildList for Node 7  
0x0300 ─── String Pool  
0x0400 ─── Handler Metadata Pool
```
All section offsets are absolute file offsets within the mmap region.


### **B.2 File Header**

```rust
struct FileHeader {  
    magic: [u8; 4];             // e.g. b"RTMI"  
    version: u16;  
    pad: u16;  
    index_off: u64;             // 0x0040  
    index_len: u32;             // number of index entries  
    root_node_off: u64;         // 0x0140  
    node_count: u32;            // 9  
    string_pool_off: u64;       // 0x0300  
    string_pool_len: u32;       // length of string pool  
    handler_pool_off: u64;      // 0x0400  
    handler_pool_len: u32;      // length of handler pool  
}  
```

## **B.3 Method + First Segment Index**

At offset **0x0040**, we encode a small index table:

| Entry | Method | First Segment | StringPool Offset | node_off |
| ----- | ------ | ------------- | ----------------- | -------- |
| 0     | GET=1  | "categories"  | 0x0300            | 0x0160   |
| 1     | GET=1  | "domains"     | 0x0312            | 0x01E0   |
| 2     | GET=1  | "users"       | 0x0322            | 0x0220   |

```rust
struct MethodPrefixIndexEntry {  
    method: u8;          // HTTP method enum  
    first_seg_off: u32;  
    first_seg_len: u16;  
    _pad: u8;  
    node_off: u64;  
}
```

This index allows the data plane to build a lookup table such as:

`HashMap<(method, &str), u64>`

and skip scanning root’s children list for common first segments.


## **B.4 Radix Tree Node Records**

Each node is a Radix Tree node describing a prefix fragment.

```rust
struct NodeRecord {  
    prefix_off: u32;  
    prefix_len: u16;  
    flags: u8;  
    child_count: u8;  
    children_off: u64;  
    handler_off: u32;  
}
```

Below are the nodes:

### **NodeRecord 0 — root (0x0140)**

```
prefix_off = 0  
prefix_len = 0  
flags = 0  
child_count = 3  
children_off = 0x0260  
handler_off = 0  
```

### **NodeRecord 1 — "/categories" (0x0160)**

```
prefix_off = 0x0300  
prefix_len = 11    // "/categories"  
flags = 1          // has handler  
child_count = 2  
children_off = 0x0280  
handler_off = handler "/categories"  
```

### **NodeRecord 2 — "/categories/search" (0x0180)**

```
prefix_off = 0x0312  
prefix_len = 4     // "/search"
flags = 1         // handler
child_count = 0  
children_off = 0  
handler_off = handler "/categories/search"  
```

### **NodeRecord 3 — "/categories/{cid}/products" (0x01A0)**

```
prefix_off = 0x031A        // "{cid}/products"  
prefix_len = (len)  
flags = 1                  // has handler  
child_count = 1  
children_off = 0x02A0  
handler_off = handler "/categories/{cid}/products"  
```

### **NodeRecord 4 — "/categories/{cid}/products/{pid}" (0x01C0)**

```
prefix_off = 0x0332  // "{pid}"  
prefix_len = (len)  
flags = 1            // handler  
child_count = 0  
children_off = 0  
handler_off = handler "/categories/{cid}/products/{pid}"  
```

### **NodeRecord 5 — "/domains" (0x01E0)**

```
prefix_off = 0x033A  
prefix_len = 8     // "/domains"  
flags = 1  
child_count = 1  
children_off = 0x02C0  
handler_off = handler "/domains"  
```

### **NodeRecord 6 — "/domains/{domain_name}" (0x0200)**

```
prefix_off = 0x0342  
prefix_len = (len)  
flags = 1  
child_count = 0  
children_off = 0  
handler_off = handler "/domains/{domain_name}"  
```

### **NodeRecord 7 — "/users" (0x0220)**

```
prefix_off = 0x034C  
prefix_len = 6     // "/users"  
flags = 1  
child_count = 1  
children_off = 0x02E0  
handler_off = handler "/users"  
```

### **NodeRecord 8 — "/users/{user_id}" (0x0240)**

```
prefix_off = 0x0354  
prefix_len = (len)  
flags = 1  
child_count = 0  
children_off = 0  
handler_off = handler "/users/{user_id}"  
```

## **B.5 Child Lists**

Each child list begins with a count, followed by that many ChildEntrys:

```rust
struct ChildEntry {  
    seg_type: u8;     // 0 static, 1 param  
    text_off: u32;  
    text_len: u16;  
    node_off: u64;  
}  
```

### **ChildList @0x0260 (root)**

```
count = 3  
ChildEntry 0: static "/categories" → node_off 0x0160  
ChildEntry 1: static "/domains"    → node_off 0x01E0  
ChildEntry 2: static "/users"      → node_off 0x0220  
```

### **ChildList @0x0280 ("/categories")**

```
count = 2  
ChildEntry 0: static "/search"  → node_off 0x0180  
ChildEntry 1: param             → node_off 0x01A0  
```

### **ChildList @0x02A0 ("/categories/{cid}/products")**

```
count = 1  
ChildEntry 0: param → node_off 0x01C0  
```

### **ChildList @0x02C0 ("/domains")**

```
count = 1  
ChildEntry 0: param → node_off 0x0200
```

### **ChildList @0x02E0 ("/users")**

```
count = 1  
ChildEntry 0: param → node_off 0x0240
```

## **B.6 String Pool (starting at 0x0300)**

```
0x0300: "/categories"
0x0312: "/search"
0x0318: "{cid}/products"
0x0332: "{pid}"
0x033A: "/domains"
0x0342: "{domain_name}"
0x034C: "/users"
0x0354: "{user_id}"
```

Strings are nul-terminated and referenced by offset+length in node and child entries.

## **B.7 Handler Metadata Pool (@0x0400)**

Handler metadata records are application-specific; example offsets:

```
0x0400: handler "/categories"  
0x0410: handler "/categories/search"         
0x0420: handler "/categories/{cid}/products"  
0x0430: handler "/categories/{cid}/products/{pid}"  
0x0440: handler "/domains"  
0x0450: handler "/domains/{domain_name}"  
0x0460: handler "/users"  
0x0470: handler "/users/{user_id}"
```

A handler record might contain an ID, permissions, flags, etc.


## **B.8 How Matching Uses These Sections**

At runtime:

1. mmap entire file; OS loads pages lazily. 
2. Read header, build a hashmap from **Method+Prefix index**.
3. On request GET /categories/100/...:
   * Look up (GET,"categories") → node_off 0x0160.
   * From there scan child list 0x0280:
     * Try "/search" → no match with "100"
     * Fall to param → node_off 0x01A0
   * Continue deeper nodes via child lists until handler found.


## **B.9 Why This Layout Works Well**

* **Direct mmap access avoids deserialization** — zero run-time parsing. 
* **Radix Tree compresses prefixes** (/categories) so fewer nodes. 
* **Method+Prefix index jumps directly** into top subtree in O(1) time.
* Efficient storage of child lists and string pool promotes cache friendliness.