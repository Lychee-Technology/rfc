# JSON Schema 扩展

## Unique Property 

在JSON Schema中，我们可以使用 `x-unique-properties` 来指定某个属性在同一 `schema` 下必须唯一。例如：

```json
{
    "type": "object",
    "properties": {
        "id": {
            "type": "string",
            "format": "uuid"
        },
        "email": {
            "type": "string",
            "format": "email"
        }
    },
    "x-unique-property": "email"
}
```

如果唯一的属性是个组合属性，那么需要将组合中的属性放在一个object中。 例如：

```json
{
    "type": "object",
    "properties": {
        "id": {
            "type": "object",
            "properties": {
                "partation_key": { "type": "string" },
                "sort_key": { "type": "string" }
            }
        },
        "name": {
            "type": "object",
            "properties": {
                "first": { "type": "string" },
                "last": { "type": "string" }
            }
        }
    },
    "x-unique-property": "id"
}
``` 


## 模型间的引用
JSON Schema 规范里，是可以用 [$ref](https://json-schema.org/understanding-json-schema/structuring#dollarref) 来指定某个属性使用其他位置（当前或者另外一个JSON Schema）定义的模型。

我希望可以实现模型间的引用关系：

### 1:N 关系

对于1:N关系，我们允许child object引用parent object中的字段。但是必须在同级（或者更上层）的schema中引用parent object中的Unique Property。例如：

* parent.schema.json
```json
{
    "type": "object",
    "$defs": {
        "id": {
            "type": "string",
            "format": "uuid"
        }, 
    },
    "properties": {
        "id": {
            "$ref": "#/$defs/id"
        },
        "name": {
            "type": "string"
        },
        "x-unique-property": "id"
    }
}
```

* child.schema.json
```json
{
    "type": "object",
    "properties": {
        "parent_id": {
            "$ref": "parent.schema.json#/$defs/id"
        },
        "description": {
            "type": "string"
        }
    }
}
```

### N:M 关系

对于N:M关系，我们需要一个中间模型。但是我们暂时不实现这个。

## 血缘角色注解：`x-lineage-role`

在 `$ref` 字段上可附加 `x-lineage-role` 注解，声明该引用在数据血缘语义上的角色。框架会在 Forma CRUD 写入时读取此注解，自动捕获记录间的血缘关系（详见 `lineage.md` 第 10 节）。

**仅有此注解的 `$ref` 字段才触发血缘捕获**，无注解的 `$ref` 仅作为普通 FK，不生成血缘边。

取值：

| 值 | 含义 |
| :--- | :--- |
| `derived_from` | 当前记录由引用记录派生或生成 |
| `source` | 引用记录是当前记录的原始信息来源 |

示例：

```json
// ai_note.schema.json
{
  "type": "object",
  "properties": {
    "source_doc_id": {
      "$ref": "document.schema.json#/$defs/id",
      "x-lineage-role": "derived_from"
    },
    "category_id": {
      "$ref": "category.schema.json#/$defs/id"
      // 无注解 → 纯 FK，不生成血缘边
    }
  }
}
```


