# **LTBase Identity & Authorization Architecture**

## **1. Architectural Positioning**

LTBase is an **API-only AI-Native BaaS** platform.

LTBase:

* Does **not** provide frontend applications
* Does **not** operate as a BFF
* Exposes public APIs to:
  * Web applications
  * Mobile applications
  * Server-side applications
  * AI agents
  * Third-party integrations

Therefore:

LTBase must act as a **full OAuth 2.0 Authorization Server + Resource Server**, not as a session-based web backend.


## **2. High-Level Architecture**

```
                ┌────────────────────┐  
                │     OAuth Client   │  
                │  (Web/Mobile/App)  │  
                └──────────┬─────────┘  
                           │  
        Authorization Code + PKCE / Client Credentials  
                           │
                           ▼  
                ┌──────────────────────┐  
                │      Auth Server     │  
                │  (Authorization AS)  │  
                │                      │  
                │ - Federated Login    │  
                │ - Token Issuance     │  
                │ - Refresh Rotation   │  
                │ - Revocation         │  
                │ - Introspection      │  
                └──────────┬───────────┘  
                           │  
                           │ Access Token  
                           ▼  
                 ┌────────────────────┐  
                 │     LTBase API     │  
                 │   (Resource RS)    │  
                 └────────────────────┘
```

External Social Providers:

* Google
* Apple
* Firebase
* Supabase
* etc.

Auth Server federates identity but issues **internal LTBase tokens only**.

# **3. OAuth Role Model**

| Role                 | LTBase Component      |
| -------------------- | --------------------- |
| Authorization Server | Auth Service          |
| Resource Server      | LTBase API            |
| Client               | External App / Server |
| Identity Provider    | Social IdP            |

# **4. Supported OAuth Grant Types**

## **4.1 Authorization Code + PKCE**

Used by:

* Web apps
* Mobile apps
* SPA

Flow:

1. Client authenticates user via Social IdP
2. Client exchanges authorization code with LTBase Auth Server
3. Auth Server validates IdP token
4. Identity Binding applied
5. LTBase access + refresh token issued


## **4.2 Client Credentials**

Used for:

* Server-to-server
* Backend integrations
* AI agent service accounts

Flow:

`POST /api/v1/auth/token`
grant_type=client_credentials  
client_id  
client_secret

No user involved.

---

## **4.3 Refresh Token**

POST /oauth/token  
grant_type=refresh_token  
refresh_token=xxx

Refresh tokens:

* Rotated on every use
* Old token immediately invalidated
* Reuse detection enabled


## **5. Token Model**

### **5.1 Access Token**

Format: JWT

Lifetime: short (60 minutes)

Purpose: API authorization

Claims:
```json
{  
  "iss": "https://o.ltbase.dev",  
  "sub": "internal_user_id",  
  "aud": "ltbase_api",  
  "project_id": "uuid",  
  "role_ids": ["Dev", "Team_Android"],
  "scope": "entity:read entity:write",
  "iat": 1700000000,  
  "exp": 1700000900,  
  "jti": "unique_token_id"  
}
```

Important:

* Permissions NOT embedded
* Only role_ids
* Authorization engine resolves permissions dynamically

### **5.2 Refresh Token**

Format: opaque

Stored server-side

Properties:

* Long-lived (30–90 days)
* Rotating
* One-time use
* Parent-child chain recorded
* Reuse detection

DynamoDB:

```
PK: auth#project#{project_id}#session#{refresh_jti}  
SK: profile  
```

### **5.3 ID Token**

Only issued if client explicitly requires OIDC identity proof.

Not used by LTBase API.

## **6. OAuth Endpoints**

### **6.1 Token Endpoint**

`POST /oauth/token`

Supports:

* authorization_code
* refresh_token
* client_credentials

Response:
```json
{  
  "access_token": "...",  
  "refresh_token": "...",  
  "expires_in": 900,  
  "token_type": "Bearer"  
}  
```

### **6.2 Revocation Endpoint**

`POST /oauth/revoke`

Payload:

```
token=xxx  
token_type_hint=refresh_token  
```


## **7. Federated Identity Handling**

### **7.1 External Token Validation**

Auth Server validates:

* Signature
* iss
* aud
* exp
* sub

Then resolves:

`auth#project#{project_id}#ext#{provider}#{issuer}#{sub}`

If not bound → IDENTITY_UNBOUND


## **8. Identity Binding Layer (Unchanged Core Model)**

Retains:

* Referral-based binding
* Policy-based binding (future)
* Multi-provider support
* Multi-project support

Binding remains atomic DynamoDB transaction.

## **9. Resource Server (LTBase API)**

LTBase API:

* Validates JWT signature
* Validates issuer
* Validates audience
* Validates expiration
* Extracts role_ids
* Calls Authorization Engine

Never handles refresh tokens.

## **10. Authorization Engine (Preserved)**

Unchanged from original AAA spec:

* Role expansion
* Permission resolution
* Row-level rules
* Column-level rules
* EAV evaluation
* Query filtering via CTE
* Audit logging

JWT contains no permission logic.


## **11. Client Type Security Rules**

### **11.1 Public Clients (Mobile / SPA)**

* Must use PKCE
* No client_secret
* Refresh token allowed but rotation enforced
* Rate limits applied

### **11.2 Confidential Clients (Server)**

* Use client_secret
* Can hold refresh tokens securely
* Stronger lifetime policies

## **12. Machine-to-Machine Model**

For B2B API usage:

grant_type=client_credentials

Access token:
```json
{  
  "sub": "service_account_id",  
  "client_id": "integration_x",  
  "scope": "entity:read",  
  "project_id": "uuid"  
}
```
No refresh token required.


## **13. Security Enhancements**

✔ Refresh token rotation
✔ Refresh token reuse detection
✔ Short access lifetime
✔ Token revocation endpoint
✔ JTI tracking
✔ Project-scoped isolation
✔ Strict issuer validation
✔ No permission-in-JWT policy


## **14. Sequence Diagram (Final)**

```
Client -> Auth Server: Authorization Code  
Auth Server -> Social IdP: Validate token  
Social IdP -> Auth Server: Claims  
Auth Server -> DynamoDB: Lookup binding  
Auth Server -> Auth Server: Resolve roles  
Auth Server -> Client: Access + Refresh  
Client -> LTBase API: Access token  
LTBase API -> Authorization Engine: Evaluate  
LTBase API -> Client: Data  
Client -> Auth Server: Refresh  
Auth Server -> DynamoDB: Rotate session  
Auth Server -> Client: New tokens  
```

## **15. Final Design Principles**

LTBase AAA now:

✔ Fully OAuth compliant
✔ API-only architecture safe
✔ Supports federation
✔ Supports M2M
✔ Supports multi-tenant projects
✔ Supports enterprise onboarding
✔ Prevents token replay
✔ Prevents permission drift
✔ Separates Authentication / Identity Binding / Authorization
✔ AI-safe policy model


## **16. What Changed From Original Spec**

| Area                | Adjustment                           |
| ------------------- | ------------------------------------ |
| OAuth Formalization | Standard /oauth/token endpoint added |
| Refresh Rotation    | Explicit rotation + reuse detection  |
| Client Types        | Public vs Confidential separation    |
| M2M Support         | client_credentials added             |
| Revocation          | Explicit revoke endpoint             |
| Token Model         | Clarified JWT vs opaque separation   |
| API-only Model      | Removed BFF assumptions              |
| Access Token Scope  | Added scope claim                    |

