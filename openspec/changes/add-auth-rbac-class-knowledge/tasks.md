## 1. 规约与工具
- [ ] 1.1 本人理解并核对四件套；verify：能用 A/B 班例子说明权限、范围及失败行为。
- [x] 1.2 安装/配置 OpenSpec 并校验初稿；verify：openspec list 能看到本 change，openspec validate add-auth-rbac-class-knowledge --strict 通过；此时不回写主规约。

## 2. 应用与数据
- [x] 2.1 建立 Node.js 应用和配置；verify：缺必要配置明确报错，GET /health 返回 200。
- [x] 2.2 建立 users、sessions、materials、knowledge_entries 表与 A/B 班测试用户；verify：密码哈希、外键有效，重复初始化不覆盖数据。

## 3. 登录与权限
- [x] 3.1 实现登录、登出、会话过期与 CSRF；verify：正确登录、错误口令、未登录 401、过期及登出重放均实际测试。
- [x] 3.2 实现服务端角色和班级校验；verify：学生上传 403，A 班不能读 B 班列表、搜索、详情和文件，伪造 class_id 无效。

## 4. 材料与界面
- [x] 4.1 实现上传校验、保存与双表事务；verify：合法文件 201，非法/超限文件被拒，注入写入故障后无部分数据；补测启动时孤立文件清理。
- [x] 4.2 实现列表、标题搜索、详情、下载；verify：教师上传后本班学生可读取，数据确实来自数据库。
- [x] 4.3 实现主题、列表/网格、Markdown 安全展示；verify：浏览器逐项操作，危险脚本无法执行。

## 5. 复现与验收
- [x] 5.1 完成 Dockerfile、Compose、.env.example 和 README；verify：真实 Docker 从干净环境启动、持久化与健康检查通过。
- [ ] 5.2 逐条运行 spec 的 Scenario；verify：记录命令、实际输出、通过/失败，三条负向证据全部保留。
- [ ] 5.3 本人复核并解释设计决策；verify：design、README、代码、运行结果一致。
- [ ] 5.4 完成实际同伴互验；verify：同伴按 README 启动并尝试跨班链接，记录真实结论，未执行不能勾选。

## 6. 归档与提交
- [ ] 6.1 最终 strict 校验；verify：无 error，警告均审阅。
- [ ] 6.2 验收通过后同步 delta 并归档；verify：change 进入带日期 archive 目录，主规约已生成，活动列表不再含本 change。
- [ ] 6.3 标记可复现版本；verify：建议 tag v0.1.0-auth-upload，从该版本启动成功。
- [ ] 6.4 向作业回收系统提交个人仓库地址；verify：由实际提交结果确认，当前尚无入口和账号信息。
