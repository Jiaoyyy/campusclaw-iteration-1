# CampusClaw · 迭代 1

面向教师和学生的班级资料网站。教师上传本班材料，学生只读访问本班资料。

当前状态：本机 Node.js 与 Docker Compose 均可运行；核心 API 自动验收、Docker 重启持久化、OpenSpec strict 校验通过。同伴互验和课程作业提交尚未完成。入门说明见《先看这里.md》。

## 范围

账号密码登录、登出、教师/学生权限、班级隔离、txt/md 上传入库、列表与标题搜索、详情与下载、浅色/深色和列表/网格视图。

## 本轮不做

大模型问答、向量检索、智能体、MCP、作业批改、PDF 解析、注册找回密码、SSO、多实例、公网域名及 HTTPS。

## 运行约定

采用 Node.js 24 内置 HTTP 服务与 SQLite，单实例部署；Docker Compose 暴露本地 8080 端口。数据库和上传文件持久化。

未登录 API 返回 401；学生上传返回 403；跨班资源统一返回 404，正文不泄露资源信息。GET /health 是无需登录的存活检查，不查数据库。数据库异常在依赖数据库的业务接口返回 503。

## 在本机启动

需要 Node.js 24 或更新版本。从仓库根复制 `.env.example` 为 `.env`，给四个 `SEED_..._PASSWORD` 填入各不相同、至少 12 位的口令。首次启动后口令哈希写入数据库，修改 `.env` 不会自动改掉已有账号口令。

执行 `npm start`，打开 `http://localhost:8080/`。初始账号是 `teacher-a`、`student-a`、`teacher-b`、`student-b`；分别对应 A/B 班教师和学生。密码取自首次启动时设置的 `.env`。测试登录、上传、退出及班级隔离可执行 `npm test`，它要求服务正在运行，且 `.env` 与首次启动时一致。

不要把 `.env`、`data/` 或 `uploads/` 提交到远程仓库。

## 用 Docker Compose 启动

安装 Docker 后配置 `.env`，执行 `docker compose up --build -d`，打开 `http://localhost:8080/`。可用 `docker compose ps` 检查 healthcheck，再运行 `docker compose down` 停止。数据库和文件保存在 Docker 的 `app_data` 与 `app_uploads` 数据卷，正常停止不会删除；`docker compose down -v` 会删除它们，请勿用它保存正式资料。本机已完成构建、健康端点访问、浏览器登录、容器重启和资料持久化验证。

## 验收规则

未登录访问 API 返回 401；学生上传返回 403；跨班详情与下载返回 404，响应不得含他班资料。`GET /health` 无需登录且只检查进程是否响应，不检查数据库。数据库故障在业务 API 中返回 503。上传仅支持非空 UTF-8 `.txt`/`.md`，最多 2 MiB。标题搜索与后续课程的知识库全文检索不同。

已运行的 API 测试见 `test/flow.test.js` 和 `test/failure.test.js`，本机和 Docker 版本均通过。OpenSpec strict 校验通过。浏览器已手工检查中文文件上传、搜索、详情、主题和视图切换；真实同伴互验、归档与课程平台提交仍需补齐。
