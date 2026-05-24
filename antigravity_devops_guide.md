# Google Antigravity 运维与开发一体化实战指南

> **提示给 AI Agent**：本文档是关于 Google Antigravity 系统架构、GCP 运维实战、官方插件库说明及调试方法论的汇总沉淀。在另一个 Antigravity 工程中，请直接载入并遵循本文档中记录的方法论与生态工具链规范。

---

## 一、 Antigravity 架构精简（Skills 与 MCP）

Antigravity 平台采用 **“大脑（思考） + 双手（执行）”** 的分工模式来驱动自主 Agent 循环：

1. **Skills (技能 - 大脑)**
   * **机制**：以 `SKILL.md` Markdown 文件形式存在的局部或全局方法论。当任务匹配时，Agent 会将其临时加载到 Context 中，指导其逐步推理与指令编写。
2. **MCP (Model Context Protocol - 双手)**
   * **机制**：标准的跨进程/双向通信协议（基于 Node/Go/Python 进程）。它直接向大模型暴露结构化、强类型的 **JSON Tools API**，允许 AI 助手免于拼接复杂的 Shell 命令行即可实现安全高效的跨系统数据传输与调用。

---

## 二、 踩坑记录与故障排查（Troubleshooting）

### 1. GitHub MCP 服务的 Docker 报错故障
* **现象描述**：Antigravity 报错 `exec: "docker": executable file not found in %PATH%`。
* **原因分析**：默认配置尝试通过容器运行 GitHub MCP，若本地 Windows 系统未安装或未配置 Docker 环境变量，则会瘫痪。
* **解决方案 (免 Docker 原生 npx 方案)**：
  修改 `~/.gemini/config/mcp_config.json`，在 Windows 环境下采用 `npx.cmd`：
  ```json
  "github-mcp-server": {
    "command": "npx.cmd",
    "args": ["-y", "@modelcontextprotocol/server-github"],
    "env": {
      "GITHUB_PERSONAL_ACCESS_TOKEN": "您的_GITHUB_TOKEN"
    }
  }
  ```

### 2. Google Cloud CLI (gcloud) Token 失效故障
* **现象描述**：运行 gcloud 或调用谷歌云 MCP 接口时返回：`invalid_grant: Bad Request`。
* **原因分析**：本地系统的 OAuth 2.0 登录凭证长时间未用，导致 Token 过期或被撤销。
* **解决方案**：
  在本地终端执行交互式刷新认证并设定项目：
  ```bash
  gcloud auth login
  gcloud config set project [YOUR_PROJECT_ID]
  ```

### 3. 项目可见性与“直连访问”限制
* **现象描述**：运行 `gcloud projects list` 时找不到控制台中某些项目（例如游戏后台或 `openClaw` 模块项目）。
* **原因分析**：列表仅显示在组织或资源管理器根目录下显式可见的项目。
* **解决方案**：只要您对该项目拥有 IAM 读取权限，**可以直接使用 `--project=[PROJECT_ID]` 强行穿透访问**。
  * 示例：`gcloud compute instances list --project=ninth-tensor-489513-n3`

### 4. 结算（Billing）配额超限报错
* **现象描述**：激活服务时报错 `Cloud billing quota exceeded`。
* **原因分析**：您的付款账户绑定项目数量达到了上限（免费账户常见）。
* **解决方案**：彻底删除无用项目释放额度，或通过 [官方通道](https://support.google.com/code/contact/billing_quota_increase) 申请增加结算绑定配额。

---

## 三、 Google 官方插件与云端 MCP 能力全景图

Antigravity IDE 深度整合了 Google 生态的官方套件，赋予 Agent 在 **部署、更新、上传、调试、监控** 方面的完整闭环能力。

### 1. Curated Google Plugins (谷歌内置插件包)
可在 **Settings > Customizations > Build with Google Plugins** 中一键开启，主要包括：

* **Firebase Plugin**
  * **部署与上传**：由 `firebase-tools` 强力驱动，支持 Agent 直接将静态资源与前端页面打包，一键上传并部署至 **Firebase Hosting**；支持将安全规则和函数一键推送到 Firestore。
  * **数据库调试**：集成专门的 Skills，支持对 Cloud Firestore 进行实时读写、索引管理与数据迁移。
* **Android CLI Plugin**
  * **编译与调试**：打包了 `android-cli` 技能。支持 Agent 自主构建 Gradle 工程（如 `./gradlew assembleDebug`）、管理 Android 虚拟设备（AVD）、直接拉起模拟器并部署与热更新调试包。
* **Chrome DevTools Plugin**
  * **调试与审计**：将 Chrome 的 DevTools 调试能力转化为 MCP 工具。支持 Agent 直接运行自动化 UI/无头浏览器测试，生成网页可访问性（Accessibility）报告，并分析前端 CSS/JS 执行性能瓶颈。
* **Modern Web Guidance**
  * 提供前沿的现代化前端开发规范，定义了最前沿的 CSS/JS 原则，确保 Agent 开发的 UI 兼具高品质美感与响应式体验。

### 2. Google Cloud Official MCP Servers (谷歌云官方 MCP 服务列表)
Antigravity 预配置了多种高阶云端 MCP 服务，充当 AI 的“双手”来简化复杂的云运维工作：

| 官方 MCP 服务名称 | 支持的核心 Tools (工具) | 主要运维场景应用（部署/更新/调试/监控） |
| :--- | :--- | :--- |
| **`cloudrun`** | `deploy_local_folder`, `deploy_container_image`, `get_service`, `get_service_log` | **一键部署/更新**：Agent 直接读取本地工程目录，在云端自动编译并完成无服务器（Serverless）微服务部署，并能实时拉取容器启动与业务日志。 |
| **`google-compute-engine`** | `list_instances`, `get_instance_basic_info`, `start_instance`, `stop_instance` | **云主机监控**：无需登录控制台，Agent 直接监控、启动、停止和重置 Compute Engine 虚拟机实例，并获取 CPU 和规格指标。 |
| **`google-cloud-logging`** | `list_log_entries`, `list_log_names` | **实时调试**：直接读取项目的云端日志中心（Cloud Logging），获取各微服务及底层主机的实时报错日志，由 Agent 直接根据报错进行代码修正。 |
| **`google-managed-service-for-apache-kafka`** | `create_topic`, `list_consumer_groups`, `get_cluster` | **数据流更新与管理**：自主维护高并发网游/分布式系统所需的 Kafka 消息中间件的主题和消费组。 |
| **`vertex-ai-search`** | `search`, `conversational_search` | **智能架构检索**：让 Agent 直接访问并理解您存储在云端企业库中的架构设计文档，以最符合您业务架构的方式进行功能编写。 |
| **`google-developer-knowledge`** | `search_documents`, `answer_query` | **API 调试支持**：在编写谷歌 API 调用代码（如 Sheets, Maps, Cloud APIs）时，提供官方最权威、最新的开发库与库调用方法查询。 |

---

## 四、 极简网游服务端架构模板 (Nginx + Node + PM2)

对于网游或涉及高频 WebSocket 通信的 Web 应用部署，AI Agent 在执行运维工作时，请直接参考以下经典黄金标准：

1. **PM2 进程守护**：使用 `pm2 status` 查看状态，使用 `pm2 reload all` 执行秒级零中断热重载（不丢失玩家当前打牌的 WebSocket 连接），使用 `pm2 logs` 实时排查游戏报错。
2. **Nginx 反向代理网关**：端口 `80` 作为流量大门，通过 `location /socket.io/` 特殊路由实现协议升级，并配置 `proxy_read_timeout 86400s` 确保游戏长连接持续处于激活状态而不被系统强行斩断。
