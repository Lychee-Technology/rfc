# Technical specification: LTBase Compute Engine




## 0. Problem statement

LTBase Compute addresses the trade-off between cost efficiency and startup latency in existing cloud compute models:

1.  **AWS Lambda cost model:** Lambda charges based on *execution duration* (wall-clock time), not actual CPU usage. For I/O-bound applications, this results in paying for idle time while waiting for Database or remote API call operations which usually accounts for >80% of the total cost.
2.  **Cold start latency:** While AWS Fargate and EC2 offer more traditional billing models, they suffer from significant cold start times (often 10s+), which makes them unsuitable for scale-to-zero or bursty workloads that require instant responsiveness.


## 1. Design philosophy

The platform follows a strict set of principles for performance and cost under modern web demands:
* **Prioritize cloud-native capabilities:** Use built-in platform services (e.g., ALB for routing, CloudWatch for metrics, EFS for storage) instead of custom implementations, for stability and lower maintenance overhead.  
* **Compute triggers only when needed:** Resources are ephemeral or highly elastic, and respond immediately to demand.
* **Real-time scaling from zero to peak:** Transition from baseline capacity to infinite cloud burst.
* **Existing resources are used before scaling new ones:** We maximize the concurrency of running tasks via Async I/O Multiplexing before spinning up new infrastructure.
* **Billing based on actual compute usage:** Under the "Zero Idle Cost" strategy, users pay for logic execution, not I/O waiting time.
* **Pre-warmed instances reduce latency:** A Fargate baseline keeps the "first byte" always fast and removes cold starts for steady traffic.
* **Zero configuration:** Users deploy code; the platform handles the scaling, routing, and isolation.


## 2. High-level architecture

- **Architecture pattern:** Hybrid Compute (Fargate Baseline + Lambda Spillover)
- **Core philosophy:** Zero Waste, Zero Config
- **Application stack:** Rust (Axum) + V8 (deno_core)
- **Target platform:** AWS (ARM64/Graviton)

The architecture uses a "Pressure Valve" model. Traffic fills the Fargate baseline first. Only when these resources are fully saturated (compute-bound) does the system spill over to Lambda.

```ascii
User Requests (HTTP/WebSocket)
       |
       v
+------------------------------------------------------------------+
|                  Application Load Balancer (ALB)                 |
|   Logic: Fill Target Group 1 -> Spillover to Target Group 2      |
+------------------------------------------------------------------+
       |                                      |
       | (Priority 1: Baseline)               | (Priority 2: Burst)
       v                                      v
+-----------------------------+        +------------------------------+
|     ECS Fargate Service     |        |       AWS Lambda             |
|  (The "Warm Pool")          |        |      (The "Elastic Tier")    |
| [Rust/Axum + V8/deno_core]  |        | [Rust/Axum + V8/deno_core]   |
+-----------------------------+        +------------------------------+
               |                                      |
               +------------------+-------------------+
                                  |
                                  v
                   +------------------------------+
                   |   Amazon EFS (Shared Cache)  |
                   | Source: Bundled User Code    |
                   +------------------------------+
```

## 3. Core strategy

### 3.1. Principle: Existing resources are used first

Before scaling out (adding more Fargate tasks or spilling to Lambda), we scale deep.

  * **Async I/O Multiplexing:** The Rust Host uses `Tokio` to interleave thousands of concurrent V8 Isolates on a single CPU core.
  * **Saturation logic:** If a request spends 190ms waiting for DB and 10ms on CPU, a single 2-vCPU Fargate task can handle hundreds of concurrent requests without latency degradation.
  * **Result:** The "Pre-warmed" baseline is used to its full capacity before paying for new resources.

### 3.2. Principle: Zero Idle Cost

  * **Billing model:** We track Wall Time vs. CPU Time.
  * **Mechanism:** When user code awaits (e.g., `await db.get()`), the V8 Isolate is suspended. The billing clock for "Active CPU" pauses, and the actual CPU hardware switches to another user.
  * **Benefit:** Users are not penalized for slow databases or external APIs.


## 4. Infrastructure specification

### 4.1. Compute layer (ARM64)

  * **A. ECS Fargate (The Warm Layer):**

      * **Role:** Handles steady-state traffic. It is the "Pre-warmed" buffer.
      * **Config:** 2 Tasks (Always-on), 2 vCPU / 4GB RAM per task.
      * **Scaling:** Conservative. It scales up slowly to maintain the baseline.

  * **B. AWS Lambda (The Burst Layer):**

      * **Role:** Handles sudden spikes (Flash Crowds) that exceed the immediate concurrency limit of Fargate.
      * **Config:** 2048 MB RAM (ARM64).
      * **Optimization:** Because V8 initializes in milliseconds, Lambda cold starts are negligible (\~100-200ms), which meets the "Real-time scaling" requirement.

### 4.2. Storage & networking

  * **EFS:** Stores user code. Mounted by both Fargate and Lambda for instant code loading.
  * **ALB:** Configured with dynamic weighted routing rules managed by a Controller Lambda (triggered by CloudWatch Alarms on Fargate saturation).


## 5. Scaling & spillover strategy

The system allocates traffic dynamically based on monitoring metrics: baseline traffic goes to Fargate, and burst traffic spills over to Lambda.

### 5.1 Trigger logic (controller components)

* **Scale up:** When CPU > 75% or Memory > 75%, scale up Fargate instances.  
* **Trigger spillover:** When CPU > 85% or Memory > 85%, trigger the spillover-controller Lambda.  
* **Recover:** When CPU < 70% and Memory < 70% for 5 minutes, trigger the disable-spillover Lambda.  
* **Scale down:** When CPU < 70% and Memory < 70% for 15 minutes, scale down Fargate instances.

### 5.2 Traffic weights (ALB weights)

* **Normal mode:** Fargate = 100, Lambda = 0
* **Spillover mode:** Fargate = 70, Lambda = 30


## 6. Code examples

### 6.1. Host code (Rust/Axum/V8)

Demonstrates Async I/O multiplexing.

```rust
use axum::{body::Body, response::IntoResponse, extract::State};
use deno_core::{JsRuntime, op2};

// 1. Define an Async Op (Multiplexing enabler)
// When JS awaits this, the thread is freed for other users.
#[op2(async)]
#[serde]
async fn op_db_query(#[serde] query: String) -> Result<String, AnyError> {
    // Tokio suspends here while waiting for DB
    let result = db_client.query(&query).await?; 
    Ok(result)
}

// 2. Request Handler
async fn handle_request(State(state): State<AppState>) -> impl IntoResponse {
    let mut runtime = JsRuntime::new(...);
    // Execute. If the user returns a Stream, we handle it.
    let result = runtime.execute_script("<anon>", "handler(req)");
    // ... process result ...
}
```

### 6.2. User guest code (TypeScript)

Demonstrates Zero Config, Streaming, and `waitUntil`.

```typescript
import { Platform } from '@ltbase/sdk';

export default async function handler(req, ctx) {
  // 1. Zero Idle Cost: When this awaits, you are not billed for CPU time.
  const user = await Platform.db.get(`user:${req.userId}`);

  // 2. Post-Response Processing: Runs AFTER response is sent.
  ctx.waitUntil(Platform.analytics.track("view", { userId: user.id }));

  // 3. Streaming Response:
  return new Response(someReadableStream, {
    headers: { "Content-Type": "text/event-stream" }
  });
}
```


## 7. Operational model

  * **Zero Configuration:** Users push code. The platform handles build (esbuild), upload (S3-\>EFS), and deployment.
  * **Zero Maintenance:** Managed runtimes handle patching. Fargate/Lambda handles auto-healing.


## 8. Cost & efficiency analysis

This section details the economic advantage of the "Fluid Hybrid" architecture (2 Fargate Tasks) compared to a standard serverless model (Standard Lambda).

### 8.1. Break-even analysis

We calculate the traffic volume required for the fixed cost of the Fargate baseline to be cheaper than paying per-request.

  * **LT Base baseline cost (2 Tasks):**
      * 2 Tasks × (2 vCPU + 4GB RAM) on ARM64.
      * Total: **\~$0.158 / hour**.
  * **Standard Lambda cost:**
      * Assumption: 1GB RAM, 200ms duration.
      * Cost per request: **\~$0.00000287**.
  * **Break-even point:**
      * $0.158 / 0.00000287 ≈ \mathbf{15.3 \text{ TPS}}$.
      * **Conclusion:** If the application sustains more than **15 requests per second**, LT Base is strictly cheaper than standard serverless.

### 8.2. Savings scenario: 100 TPS (I/O heavy)

A simulated real-world workload: 100 requests/sec, 200ms total latency, but only 10ms actual CPU time (I/O bound).

  * **Standard Lambda (pay for waiting):**

      * Billed duration: 200ms per request (Lambda charges for I/O wait).
      * Monthly cost: **$742.46**.

  * **LT Base Compute (pay for logic):**

      * **Capacity check:** 100 TPS × 10ms CPU time = 1 vCPU of load.
      * The baseline (2 Tasks = 4 vCPUs) is only at 25% utilization. No Spillover needed.
      * Monthly cost: **$113.76** (fixed baseline cost).

  * **Final comparison:**

      * **Savings:** $628.70 per month.
      * **Reduction:** 84.7% cheaper than standard Lambda.

### 8.3. Summary

Async I/O Multiplexing removes billing for wait time, and a lean Fargate baseline provides cheap, always-on compute. Together they give LT Base an 85% cost reduction for typical I/O-bound web workloads, and it can still burst infinitely via Lambda.