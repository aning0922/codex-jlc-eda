# 测试、贡献与发布复核

所有命令从源码根目录运行，先确认package身份并设置`PROJECT_ROOT="$(pwd -P)"`。构建及测试不需要旧工作台、旧 dist 或旧 node_modules。

| 分组 | 命令 | 资料与资格 |
|---|---|---|
| 自包含离线单元与模拟协议 | `npm --prefix "$PROJECT_ROOT" test` | 合成 fixture、原几何测试、路径/状态/网络/原生脚本拒绝行为、搬迁 bundle。无 EDA 调用；跳过/待做/取消非零即失败。 |
| 编译公共 MCP | `npm --prefix "$PROJECT_ROOT" run test:protocol` | MCP initialize、tools/list、35 schema 与冻结基线逐项比对、35 个非法输入拒绝、模拟 doctor、CLI 调用哨兵。不是实机或实际宿主资格。 |
| 私有真实捕获资料回归 | `npm --prefix "$PROJECT_ROOT" run test:fixtures` | 下列所有环境变量必须存在；缺失立即非零退出，不能默默跳过。不是重新运行 EDA。 |
| 真实 EDA 集成 | 人工/受控环境，见 RC 实例 | macOS + 已验证版本、可用账户/库与稳定宿主界面能力；A6–A9-R1 在 4.1.71 有限定实机结果，实际聊天宿主与 A10 尚待验收，见 [开发进展](development-status.md)。 |

私有资料组要求 `MANUFACTURING_FIXTURE_DIRECTORY`（旧 10 件/25 孔制造捕获）、`PASSIVE_MANUFACTURING_FIXTURE_DIRECTORY`（B 阻容修改后 13 件/28 孔、保留其当时 C5 告警的制造捕获）、`INCREMENTAL_NATIVE_ADOPTION_FIXTURE`（实际模型采用 JSON，同目录真实 work-project.json）、`INCREMENTAL_CLOSED_WORK_FIXTURE`（真实 closed work-project.json，其来源文件均可读取）、`PASSIVE_REAL_FIXTURE`（原阻容模型/计划回归 JSON）。这些不是任意新板都可替代的测试资料，不随公开仓库分发。不得因新板不满足旧计数而改写旧 journal。没有私有资料时使用默认离线组，并报告该组未执行。

测试启动器把两个制造目录复制到全新临时目录后才运行分析器；原捕获资料不写回。closed 测试也创建自己的临时副本，其模拟 journal 仅是软件反例，不能作为真实 EDA 保存证据。其余私有模型测试只读输入。公开 fixture 的来源见 `tests/fixtures/README.md`。

历史依赖旧工作台 artifacts 的测试没有假装迁移成功；完整迁移/排除清单见 `test-inventory.json`。本轮没有重跑此前 164 项实机资料回归，也不把 0.10.0 的资格算入 Alpha 当前测试数。

## 干净构建与解包检查

```sh
PROJECT_ROOT="$(pwd -P)"
node -e 'if(require("./package.json").name!=="codex-jlc-eda") process.exit(1)'
npm --prefix "$PROJECT_ROOT" ci --ignore-scripts --no-audit --no-fund
npm --prefix "$PROJECT_ROOT" test
npm --prefix "$PROJECT_ROOT" run test:protocol
npm --prefix "$PROJECT_ROOT" run package
```

将 source ZIP 解到新的目录，再从该目录运行同样的命令；不要链接旧依赖。把 runtime ZIP 解到另一个目录，回到源码目录执行：

```sh
node scripts/verify-package.mjs "/absolute/path/to/unpacked-runtime" --runtime
```

`MANIFEST.json` 记录 payload SHA-256 和字节数（不包含自身）；外部 `SHA256SUMS` 对两个 ZIP 校验。ZIP 时间戳固定为 1980-01-01。构建显式设置 alwaysStrict，不继承父目录 tsconfig。打包前自动重建，避免带入过期 bundle。相同源码、依赖和构建环境连续打包应字节一致；不承诺不同 esbuild/Node 版本之间完全相同。`release-files.json` 是明确白名单，新增公开文件需审查后加入。

GitHub Actions 配置执行锁定安装、离线测试、编译协议、打包和搬迁解包验证。它不会启动 EDA，不证明真实板图正确；远端结果以 [Actions](https://github.com/aning0922/codex-jlc-eda/actions) 对应提交为准。贡献前在本机运行相同检查，避免上传模型、eprj2、journal、账户或未脱敏日志。改动制造分析器时必须使用新捕获副本。接口变更需要明确版本变更及对应 schema 基线审查，不可为让测试通过而随意更新 golden 文件。
