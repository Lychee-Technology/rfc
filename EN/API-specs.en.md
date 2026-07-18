# LTBase API Specifications

This index points to the split LTBase API specification documents by service.

- Document language: English
- Updated on: 2026-07-17

## Documents

- `API-specs-data-plane.en.md`: current data-plane HTTP API, including Notes, Forma, CRUD Agent, semantic, ontology, governance, compliance, discovery, and intent-to-action planning.
- `API-specs-authservice.en.md`: the standalone end-user token service (`cmd/authservice`) — provider login exchange, identity binding, token refresh/revocation, and public profile lookup.
- `API-specs-control-plane-service-auth-routes.en.md`: control-plane admin REST APIs under `/api/v1/auth/...`, including auth config, users, roles, policies, principal policy attachments, binding policies, and referrals.
- `API-specs-control-plane.en.md`: control-plane admin REST APIs under `/api/v1/org/...` plus the separate legacy `/control-plane` operational action API.

## Recommended Reading Order

1. [Data Plane APIs](API-specs-data-plane.en.md)
2. [Auth Service (End-User Token Service) APIs](API-specs-authservice.en.md)
3. [Auth Admin Routes APIs](API-specs-control-plane-service-auth-routes.en.md)
4. [Control Plane APIs](API-specs-control-plane.en.md)
