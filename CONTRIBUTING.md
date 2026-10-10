# Contributing / 贡献指南

感谢帮助核对可复现性和边界。This developer preview values reproducible evidence and clearly bounded changes.

## 开始前 / Before you change anything

- 阅读 [README](README.md) / [English README](README.en.md) 和 [SECURITY](SECURITY.md)。普通问题使用 Issue 模板；漏洞细节走私密渠道，未配置时不公开载荷或凭据。
- Keep changes focused. Do not introduce arbitrary native JavaScript escape hatches, weaken verification, edit journals to manufacture completion, or label mocked tests as real-editor results.
- 模型、原生工程、截图、制造数据与日志可能包含第三方内容或隐私。只提交有分发权且已脱敏的最小材料；不要上传真实项目来“帮助调试”。Only contribute materials you may distribute.
- 自有贡献沿用 MIT；保留第三方版权与许可，不把外部代码重新授予 MIT。Disclose the origin and license of copied or adapted code.

## 本地验证 / Local checks

在本仓库根目录确认 package 身份，再显式绑定 npm 路径：

```sh
PROJECT_ROOT="$(pwd -P)"
node -e 'const p=require("./package.json"); if(p.name!=="codex-jlc-eda") process.exit(1)'
npm --prefix "$PROJECT_ROOT" ci --ignore-scripts --no-audit --no-fund
npm --prefix "$PROJECT_ROOT" test
npm --prefix "$PROJECT_ROOT" run test:protocol
npm --prefix "$PROJECT_ROOT" run package
node scripts/audit-release.mjs
node scripts/check-docs.mjs
```

默认离线组不使用 EDA，跳过项非零会失败。Private capture tests and real-editor checks are separate; list them as not run when prerequisites are absent. See [testing details](docs/testing.md).

依赖审查须包括打包进 runtime 的 devDependencies。Run `npm --prefix "$PROJECT_ROOT" audit --json`, then assess findings against actual bundle inputs and entry points. Do not use `npm audit fix` as an unreviewed blanket upgrade. The dependency advisory history and targeted fixes are documented in [dependency security](docs/dependency-security.md).

## 提交说明 / Pull requests

说明具体问题、前后行为、修改范围、验证命令及未验证项。Describe the concrete behavior change, evidence and remaining limits. 修改公共schema、版本、许可、白名单或依赖时明确列出；不能仅更新golden文件让测试变绿。

中英文README的版本、命令和事实应一致；更新相关文档相对链接。Add new public files to `release-files.json` after reviewing their contents. Never overwrite a previously reviewed release directory with different bytes under the same version.

本仓库尚未公开，也没有远端CI运行记录。提交作者、维护者及私密安全渠道由发布者确认；不要虚构身份或承诺响应时间。The project is not affiliated with JLCEDA or OpenAI.
