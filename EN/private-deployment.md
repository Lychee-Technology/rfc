# **LTBase Self-Hosted Technical Specification**

## **1. Executive Summary**

To comply with strict enterprise requirements regarding **data sovereignty**, **privacy**, and **security auditing**, LTBase provides a self-hosted deployment solution based on an **"Artifact Delivery" model**.

In this model, LTBase is responsible solely for securely delivering compiled and signed software artifacts (zip packages) to the customer's AWS S3 bucket. **The customer retains full ownership and control over all infrastructure resources, application data, and deployment pipelines.**

## **2. Architecture Design**

The solution utilizes a **Dual-Link OIDC (OpenID Connect)** trust model, ensuring a complete separation of permissions between software delivery and infrastructure operations.

### **2.1 Component Ownership Matrix**

| Component | Ownership | Description |
| :---- | :---- | :---- |
| **AWS Infrastructure** | **Customer** | All runtime resources (VPC, Lambda, RDS, S3, etc.). |
| **GitHub Repo (Ops)** | **Customer** | The CDK code repository forked and managed by the customer. |
| **CI/CD Pipeline** | **Customer** | Workflows running within the customer’s GitHub Actions. |
| **Software Artifacts** | LTBase to Customer | Compiled binaries pushed by LTBase, stored in Customer S3. |
| **Source Code** | LTBase | Core business logic remains closed-source (IP protection). |

### **2.2 Data Flow**

1. **Delivery Flow:** LTBase GitHub \-\> Customer S3 (Write-only)  
2. **Deployment Flow:** Customer GitHub \-\> Customer AWS Resources (Read Artifacts \-\> Update Infra)

## **3. Security & Permission Model**

We adhere to **Zero Trust** and **Least Privilege** principles.

### **3.1 Authentication: Keyless Architecture**

This solution **does not use** long-term AWS Access Keys (AK/SK). All cross-account interactions are authenticated via **OIDC**, using short-lived temporary credentials.

### **3.2 Permission Boundaries**

#### **Role A: Artifact Receiver Role**

* **User:** LTBase Official Github Actions.  
* **Trust Entity:** Trusts *only* the LTBase Official GitHub Repository (repo:Lychee-Technology/ltbase.api:\*).  
* **Permission Scope:** **Write-Only**.  
  * ✅ s3:PutObject (Upload new versions)  
  * 🚫 s3:GetObject (Cannot read customer data/configs)  
  * 🚫 s3:ListBucket (Cannot list file structure)

#### **Role B: Deployment Ops Role**

* **User:** Customer’s Internal Pipeline.  
* **Trust Entity:** Trusts *only* the Customer's GitHub Repository (repo:\<CustomerOrg\>/\<Ops-CDK-Repo\>:\*).  
* **Permission Scope:** **Infrastructure Management**.  
  * ✅ cloudformation:\*, lambda:\*, s3:GetObject, etc.  
  * *Note: This role is defined and governed entirely by the customer.*

## **4. Integration Workflow**

### **Phase I: Initialization**

**Step 1: Infrastructure Prep (Customer)**

1. Provision an S3 Bucket (e.g., ltbase-artifacts-prod) with Versioning enabled.  
2. Configure the IAM OIDC Provider for GitHub Actions (if not already present).

**Step 2: Establish Delivery Trust (Customer)**

1. Create the **Artifact Receiver Role**.  
2. Configure the Trust Policy to allow the LTBase Repo to assume this role.  
3. Configure permissions to allow PutObject only on the target bucket.  
4. **Output:** Provide the Role ARN and Bucket Name to the LTBase team.

**Step 3: Establish Deployment Trust (Customer)**

1. Fork the LTBase Private Deployment CDK Project into the **Customer's GitHub account**.  
2. Create the **Deployment Ops Role**, trusting the Customer's own repo.  
3. Store the Role ARN in GitHub Secrets.

### **Phase II: Continuous Delivery**

Once initialized, the update process is automated:

1. **Release:** LTBase releases a new version and automatically pushes the signed `ltbase-dataplane-lambda-<tag>.zip` to the Customer's S3 via *Role A*.  
2. **Trigger:** The customer triggers the workflow in their own GitHub repository.  
3. **Deploy:** The Customer's CDK script picks up the newest S3 object, assumes *Role B*, and updates the AWS Lambda functions.

## **5. Rollout Strategy**

To ensure business continuity, the CDK includes a built-in **Canary Release** strategy:

1. **Beta Stage:** Deployed to an isolated test environment for validation.  
2. **One-box Stage (Canary):**  
   * A new version(e.g., 10) is published to the Production Lambda.  
   * The one-box alias is updated to point to this version (e.g., 10).  
   * **1% of live traffic** is routed to one-box for smoke testing.  
3. **Production Stage:**  
   * Upon validation, the prod alias (e.g., currently points to version 9) is updated to the new version(e.g., 10).  
   * **100% traffic** migration.  
   * The old version is retained for instant rollback if necessary.

### **5.1 Github Actions**

* `Deploy-to-beta` . Customer’s Internal operator manually triggers it, then it copies the newest version of LTBase app from the asset bucket to  `/beta/current.zip` and deploys it to `beta`  
* `Deploy-to-one-box`, Customer’s Internal operator manually triggers it, then it copies `/beta/current.zip` to `/prod/current.zip` and deploys it to the `prod` lambda and update the `one-box` alias  
* `Deploy-to-prod`, Customer’s Internal operator manually triggers it, then it update the `prod` alias to the same version as `one-box`