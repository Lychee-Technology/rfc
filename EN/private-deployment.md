# **LTBase Self-Hosted Technical Specification**

## **1. Executive Summary**

To comply with strict enterprise requirements regarding **data sovereignty**, **privacy**, and **security auditing**, LTBase provides a self-hosted deployment solution based on an **"Artifact Subscription" model**.

In this model, LTBase hosts signed, pre-compiled software artifacts in a centralized, secure repository. **The customer retains full ownership and control over all infrastructure resources, application data, and the deployment lifecycle.**



## **2. Architecture Design**

The solution employs a **Pull-Based** architecture. The Customer’s infrastructure actively requests updates from LTBase, ensuring that **no external entity has write access** to the customer's environment.

### **2.1 Component Ownership Matrix**

| Component               | Ownership    | Description                                                                      |
| :---------------------- | :----------- | :------------------------------------------------------------------------------- |
| **AWS Infrastructure**  | **Customer** | All runtime resources (VPC, Lambda, RDS, S3, etc.).                              |
| **Orchestration (CDK)** | **Customer** | The IaC (Infrastructure as Code) repository, forked and managed by the customer. |
| **Release Repository**  | LTBase       | Centralized S3 bucket hosting signed versioned artifacts.                        |
| **Source Code**         | LTBase       | Core business logic remains closed-source (IP protection).                       |

### **2.2 Data Flow**

1. **Publication:** LTBase publishes signed artifacts to the **LTBase Release Repository** (S3).  
2. **Subscription (Pull):** The Customer's deployment pipeline (running in the Customer's AWS account) authenticates via AWS IAM and **pulls** the specific versioned artifact directly from LTBase.  
3. **Deployment:** The Customer's CDK updates their local AWS Lambda functions using the pulled artifact.

## **3. Security & Access Control**

We adhere to **Zero Trust** and **Least Privilege** principles.

### **3.1 Authentication: Cross-Account Access**

Access to software artifacts is governed by **AWS Cross-Account IAM Policies**.

* **Mechanism:** LTBase maintains an allow-list of authorized Customer AWS Account IDs on the Release Repository.  
* **Customer Permission:** The customer grants their internal deployment role s3:GetObject permission for the arn:aws:s3:::ltbase-releases/\* bucket.  
* **No Inbound Access:** LTBase requires **zero** inbound access (Write/AssumeRole) to the customer's AWS environment.

## **4. Integration Workflow**

### **Phase I: Onboarding**

1. **Account Whitelisting:** The Customer provides their **AWS Account IDs** to LTBase.  
2. **Access Provisioning:** LTBase updates the Release Repository policy to grant read access to the provided Account ID.  
3. **Infrastructure Setup:**  
   * Customer forks the **LTBase Private Deployment CDK** repository.  
   * Customer configures their internal CI/CD pipeline (see *Appendix A* for reference).

### **Phase II: Continuous Delivery**

Updates are **customer-initiated**. LTBase cannot force updates into the customer environment.

1. **Release Notification:** LTBase notifies the customer of a new version (e.g., v1.2.0).  
2. **Version Pinning:** The Customer's DevOps engineer updates the version tag in their forked CDK configuration (e.g., const version \= "v1.2.0").  
3. **Deployment:** The Customer commits the change, triggering their internal pipeline to pull the artifact and update the infrastructure.


**Appendix A: Reference CI/CD Architecture**

While customers may use any CI/CD tool (Jenkins, GitLab, etc.), LTBase provides a reference implementation using **GitHub Actions** and **AWS OIDC**.

### **A.1 Keyless Authentication (OIDC)**

To avoid managing long-term AWS Access Keys (AK/SK), we recommend a **Dual-Link OIDC (OpenID Connect)** trust model.

* **Deployment Ops Role:** A role created in the Customer's AWS Account.  
* **Trust Policy:** Configured to trust *only* the Customer's forked GitHub Repository (repo:\<CustomerOrg\>/\<Ops-CDK-Repo\>:\*).  
* **Process:**  
  1. GitHub Actions requests a JWT token from GitHub.  
  2. AWS validates the token against the configured OIDC Provider.  
  3. AWS issues short-lived temporary credentials to the runner to execute cdk deploy.

### **A.2 Pipeline Workflow**

The reference GitHub Action workflow performs the following:

1. **Checkout:** Pulls the Customer’s CDK code.  
2. **Assume Role:** Assumes the *Deployment Ops Role* via OIDC.  
3. **Fetch Artifact:** Downloads the target version zip from LTBase S3 (using the assumed role's cross-account permissions).  
4. **Synthesize & Deploy:** Runs cdk deploy to update the stack.


**Appendix B: Safe Rollout Architecture (AWS CodeDeploy)**

To mitigate the risk of service disruption during updates, the LTBase CDK solution utilizes **AWS CodeDeploy** in conjunction with **AWS Lambda Aliases**. This approach ensures zero-downtime deployments and automated failure recovery.

### **B.1 Core Mechanism: Alias Traffic Shifting**

Rather than replacing the running code instantaneously, CodeDeploy manages a **Weighted Alias** strategy.

* **The Alias:** A stable identifier (e.g., Prod) that client applications invoke.  
* **The Shift:** CodeDeploy dynamically adjusts the routing weights of this alias, distributing incoming traffic between the **Current Version (N)** and the **New Version (N+1)**.

### **B.2 The Deployment Lifecycle**

When the Customer triggers an update via CDK, the following automated sequence occurs:

1. **Provisioning (Immutable Versioning):**  
   * The CDK uploads the new artifact and publishes a new, immutable Lambda Version (e.g., v2).  
   * At this stage, v2 exists but receives **0%** traffic. The Prod alias still points 100% to v1.  
2. **Traffic Shifting (Canary Phase):**  
   * CodeDeploy reconfigures the Prod alias to split traffic based on the defined strategy (e.g., **Linear10PercentEvery1Minute**).  
   * **Minute 0:** 90% Traffic $\\to$ v1 | 10% Traffic $\\to$ v2.  
   * **Minute 1:** 80% Traffic $\\to$ v1 | 20% Traffic $\\to$ v2.  
   * *This process continues incrementally.*  
3. **Continuous Monitoring (The Safety Net):**  
   * During the shifting window, CodeDeploy actively monitors specific **CloudWatch Alarms** (configured by the CDK).  
   * **Key Metrics:** Lambda Error Rate (5xx) and P99 Latency.  
4. **Outcome A: Success & Finalization**  
   * If no alarms are triggered, CodeDeploy shifts 100% of traffic to v2.  
   * The deployment is marked as "Succeeded."  
5. **Outcome B: Automatic Rollback**  
   * **Trigger:** If *any* alarm breaches its threshold (e.g., Error Rate \> 1%) while traffic is shifting.  
   * **Action:** CodeDeploy **immediately** resets the Prod alias to point 100% back to the stable v1.  
   * **Result:** The system returns to a known good state within seconds, minimizing impact on end-users.

### **B.3 Configuration Strategy**

The CDK allows customers to select their preferred risk profile:

* **Linear10PercentEvery1Minute:** (Default) Gradual shift over 10 minutes. Balanced safety.  
* **Canary10Percent5Minutes:** Sends 10% traffic for 5 minutes (smoke test). If successful, instantly shifts the remaining 90%.  
* **AllAtOnce:** Immediate switch (High risk, fastest deployment).

**Appendix C: Why Lambda Zip Artifacts?**

LTBase distributes highly optimized Go binaries as Lambda Zip archives. This approach minimizes cold-start latency and eliminates the operational overhead and cost of maintaining private Container Registries (ECR).

**Appendix D: Note on Access Control Granularity**

LTBase authorizes the Customer's AWS Account ID (Root) on the bucket policy. This delegates strict access control to the Customer's internal IAM administrators, allowing them to precisely manage which internal roles (e.g., CI/CD pipelines) are permitted to pull artifacts without requiring LTBase intervention for internal rotation or reconfiguration.