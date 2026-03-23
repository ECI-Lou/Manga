# Manga Attribution Assistant (漫画台词角色分配助手)

本项目是一个基于 AI 视觉大模型（VLM）的漫画台词识别与角色分配系统。它能够自动提取漫画书页中的对话框和旁白，识别文本内容，并根据用户配置的角色列表（Cast List）自动判断说话人，最后输出带有精确坐标（Bounding Box）的结构化数据。

---

## 1. User Guidance (用户指南)

本指南面向最终用户（如汉化组、漫画编辑、数据标注员等），帮助您快速上手并充分利用本系统的各项功能。

### 1.1 快速上手 (Quick Start)
1. **配置模型**：在左侧 `Model Setup` 模块选择您要使用的 AI 模型。默认支持 Google Gemini 系列，也可以切换到 OpenRouter 使用其他第三方模型。
2. **设定角色**：在 `Cast Editor` 模块中，添加当前漫画中出现的角色名称及其特征描述。描述越准确，AI 识别说话人的成功率越高。
3. **上传图片**：在中间的 `Input Pages` 模块，点击或拖拽上传需要处理的漫画图片（支持多张）。
4. **运行分析**：点击 `Run Analysis` 按钮，等待 AI 处理。
5. **导出数据**：处理完成后，右侧会显示识别结果。您可以点击右上角的 `JSON` 或 `XLSX` 按钮将数据导出到本地。

### 1.2 核心模块说明 (Core Modules)
* **Model Setup (模型设置)**：
  * **Provider & Model**: 选择 AI 驱动引擎。支持内置的 Google Gemini（如 Gemini 3 Flash/Pro）以及通过 OpenRouter 接入的自定义模型（如 Claude 3.5 Sonnet）。
  * **API Key**: 如果使用 Google 模型，系统会自动调用平台授权；如果使用 OpenRouter，需要您手动输入对应的 API Key。
* **Cast Editor (角色编辑器)**：
  * 用于维护当前漫画的“演员表”。包含 `Name`（角色名）和 `Description`（外观或身份描述）。AI 会根据这里的描述与画面内容进行比对，从而判断某句话是谁说的。
* **Input Pages (页面输入)**：
  * 漫画图片的上传区域。支持预览和移除已上传的图片。
* **Transcription Result (识别结果)**：
  * 展示 AI 解析后的结构化数据。每一行包含：编号、角色名、坐标信息和具体的台词文本。
* **System Logs (系统日志)**：
  * 位于右下角的黑色控制台，实时显示系统的运行状态、耗时、Token 消耗以及报错信息，方便排查问题。

### 1.3 术语解释 (Terminology)
* **Role (说话人/角色)**：说出该句台词的角色名称。如果 AI 无法确定，会标记为 `UNKNOWN`；如果是旁白，会标记为 `NARRATION`；如果是音效词（系统默认尽量排除，但若识别到）会标记为 `SFX`。
* **bbox1000 (归一化边界框)**：表示台词在图片中的位置坐标。格式为 `[ymin, xmin, ymax, xmax]`。数值范围是 0 到 1000，代表该点在图片宽度或高度上的千分比位置。这种格式与图片的实际分辨率无关，方便在不同设备上进行坐标还原。
* **Token**：AI 模型处理文本和图片的基本计价/计算单元。`System Logs` 中会显示每次请求消耗的 Token 数量。

---

## 2. Tech/Migration Description (技术架构与迁移指南)

本指南面向研发团队，旨在帮助开发人员快速理解当前 MVP（最小可行性产品）的技术架构，并为后续将系统迁移到公司自有服务器及进行迭代开发提供指导。

### 2.1 技术栈 (Tech Stack)
* **前端框架**: React 19 + TypeScript + Vite
* **样式方案**: Tailwind CSS
* **AI SDK**: `@google/genai` (用于 Gemini 模型), 原生 `fetch` (用于 OpenRouter/OpenAI 兼容接口)
* **数据导出**: `xlsx` (用于生成 Excel 文件)

### 2.2 核心架构与代码结构 (Core Architecture)
当前 MVP 是一个 **纯前端 (Client-Side SPA)** 应用，所有的业务逻辑、文件读取和 AI API 调用均在浏览器端完成。

* `src/App.tsx`: 应用的主入口和页面骨架，管理全局状态（图片列表、识别结果、日志等）。
* `src/services/geminiService.ts`: **核心业务逻辑层**。封装了与大模型的交互逻辑。
  * 包含极其详尽的 `systemInstruction`（Prompt），定义了 AI 如何提取文本、计算 `bbox1000`、合并对话框以及匹配角色。
  * 实现了双分支逻辑：分支一使用 `@google/genai` 调用 Gemini；分支二使用 `fetch` 构造 OpenAI 兼容格式调用 OpenRouter。
* `src/types.ts`: 全局 TypeScript 类型定义（如 `CastMember`, `DialogueLine`, `AnalysisResult`）。
* `src/components/`: 包含拆分的 UI 组件（如 `CastEditor`, `TokenDisplay`）。

### 2.3 核心 Prompt 解析 (Core Prompt Analysis)
在 `src/services/geminiService.ts` 中，Prompt 的设计是整个系统的灵魂，迁移时**必须完整保留**：
1. **坐标归一化 (Normalization)**：强制 AI 将像素坐标转换为 0-1000 的相对坐标 (`bbox1000`)，避免了因图片缩放导致的坐标偏移。
2. **气泡合并规则 (Balloon merging rule)**：明确规定同一个对话框内的多段文本必须合并为一条记录，且不能跨对话框合并。
3. **阅读顺序 (Reading order)**：强制 AI 按照日式漫画的阅读习惯（从上到下，从右到左）对识别结果进行排序并赋予 ID。
4. **JSON 强制输出**：通过 `responseSchema` (Gemini) 或 Prompt 约束 (OpenRouter)，确保模型严格返回前端可解析的 JSON 格式。

### 2.4 迁移与部署指南 (Migration & Deployment Guide)

#### 2.4.1 现状说明
当前系统在原型平台上作为纯前端应用运行。API Key 是通过平台环境注入或用户前端输入的。在企业级生产环境中，**在前端直接调用大模型 API 并暴露 API Key 是极不安全的**。

#### 2.4.2 迁移到公司服务器的步骤 (BFF 架构改造)
为了安全和可扩展性，建议在迁移时引入 Node.js (Express/NestJS) 或 Python (FastAPI) 作为后端（BFF 层）。

1. **后端 API 搭建**：
   * 创建一个后端服务，将 `src/services/geminiService.ts` 中的逻辑迁移到后端。
   * 后端提供一个接口（如 `POST /api/analyze-manga`），接收前端传来的图片（Base64 或 OSS URL）和角色列表（Cast List）。
   * **API Key 管理**：将 Gemini 和 OpenRouter 的 API Key 配置在后端服务器的环境变量（`.env`）中，彻底从前端移除。
2. **前端改造**：
   * 将 `App.tsx` 中的 `runAnalysis` 函数修改为调用公司后端的 `/api/analyze-manga` 接口。
   * 移除前端代码中对 `@google/genai` 的直接依赖。
3. **图片上传优化**：
   * 当前 MVP 将图片转为 Base64 一并发送给大模型，如果图片较多会导致 Payload 过大。
   * **迭代建议**：前端先将图片上传到公司的对象存储（OSS/S3），后端拿到图片 URL 后，再由后端下载或直接将 URL 传给支持 URL 识别的大模型。
4. **部署**：
   * 前端通过 `npm run build` 打包为静态资源，部署到 Nginx 或 CDN。
   * 后端通过 Docker 容器化，部署到公司的 Kubernetes 或云服务器上。

#### 2.4.3 后续迭代建议 (Iterative Development)
* **状态持久化**：引入数据库（如 PostgreSQL 或 MongoDB），保存用户的 Cast List 模板和历史识别记录。
* **人工校验与微调 (Human-in-the-loop)**：在前端增加对 `bbox1000` 坐标的 Canvas 渲染层，允许用户直观地在图片上拖拽修改识别框，并手动修正识别错误的文本或角色。
* **长篇连载支持**：支持批量处理整话漫画，并在多页之间共享上下文，提高角色识别的连贯性。
