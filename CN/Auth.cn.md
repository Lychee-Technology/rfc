# API 认证规范

## Access Key 和 Access Secret 规范

Access Key 和 Access Secret 用于 API 请求的身份认证。每个 Tenant 可以创建多个 Access Key 和对应的 Access Secret。每对 Key 和 Secret 都是基于 Ed25519 公钥加密算法生成的。服务器端并不会存储 Access Secret，只会存储 Access Key 及其关联的元数据。

### **详细要求**

#### **1. Access Key 规范**

格式:
- `AK_{base64_urlsafe(access_key_id)}`

示例: 
- `AK_PSnulf1ATHSlQ5VgzV9CIg`


#### **2. Access Secret 规范**

格式: 
- `SK_{base64url(Ed25519PrivateKey)}`
示例: 
- `SK_MC4CAQAwBQYDK2VwBCIEIPro6WPVBiMoFCjDT5U8NjqJeIsPcA4PNLOta8DLnjfE`


## **签名规范**

### **签名字符串构造**
签名字符串由以下部分组成，使用换行符 `\n` 连接：
1. HTTP 方法（大写）
2. 不包含查询参数的请求URL与路径，不含尾部的`/`和/或`?`。例如对于 `https://api.example.com/v1/resource/`，应使用 `https://api.example.com/v1/resource`
3. 查询参数字符串（按字典序排序的URL Encode之后的 `key=value` 对，用 `&` 连接，如果没有查询参数则为空字符串）。例如，对于查询参数 `b=2&a=1&b=1`，应使用 `a=1&b=1&b=2`
4. 请求体(body)的 SHA256 哈希值（十六进制字符串，如果没有请求体则为 SHA256 空字符串的哈希值）
5. 时间戳（Timestamp, Unix 时间戳，毫秒）
6. Nonce（随机字符串）

### **签名生成**
使用 Ed25519 算法对签名字符串进行签名，生成签名字节串。然后对签名字节串进行 Base64 URL 安全编码，得到最终的签名(Signature)字符串。

## **认证流程**

1. **提取认证信息**: 从请求头 `Authorization` 中提取认证信息。Authorization Header式样为`LtBase {Access Key ID}:{Signature}:{Timestamp}:{Nonce}`
   - `Access Ke ID`: 访问密钥的ID
   - `Signature`: 使用 Access Secret 对签名字符串进行签名后的 Base64 URL 安全编码结果
   - `Timestamp`: 请求发起的 Unix 时间戳（毫秒）
   - `Nonce`: 随机字符串，防止重放攻击

2. **验证时间戳和Nonce**: 确保请求的时间戳在允许的时间窗口内（例如，5分钟内），确保Nonce只使用过一次，以防止重放攻击。
3. **检索 Access Key**: 使用提供的 Access Key ID 从 DynamoDB 中检索对应的public key数据和元数据，确保access key存在且没有失效。