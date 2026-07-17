# LTBase API 规格索引

本文档作为 LTBase API 规格的入口，按 service 拆分后的文档如下。

- 文档语言：中文
- 更新日期：2026-06-09

## 文档列表

- `API-specs-data-plane.cn.md`：当前 data plane HTTP API，包括 Notes、Forma、CRUD Agent、semantic、ontology、governance、compliance、discovery、intent-to-action planning。
- `API-specs-control-plane-service-auth-routes.cn.md`：`/api/v1/auth/...` 下的 control-plane admin REST API，包括 auth config、users、roles、policies、principal policy attachments、binding policies、referrals。
- `API-specs-control-plane.cn.md`：`/api/v1/org/...` 下的 control-plane admin REST API，以及与其分离的旧版 `/control-plane` 运维 action API。

## 推荐阅读顺序

1. [Data Plane APIs](API-specs-data-plane.cn.md)
2. [Auth Service APIs](API-specs-control-plane-service-auth-routes.cn.md)
3. [Control Plane APIs](API-specs-control-plane.cn.md)
