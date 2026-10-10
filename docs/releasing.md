# Maintainer release checklist / 维护者发布检查单

This file is a procedure, not authorization to publish. 本轮只准备本地材料，尚未创建远端或上传。**Alpha.3已做有界依赖修复；由发布协调者独立复核后统一创建仓库、启用私密报告并发布。**

## Decisions before release / 发布前需确定

- 目标已确定为`aning0922/codex-jlc-eda`；使用发布者核实的提交作者/邮箱，确认自有代码处分权，不编造身份。
- Review [source/license boundaries](sources-and-licenses.md) and confirm the collective copyright attribution in LICENSE. Exclude unlicensed models/native projects/screenshots/manufacturing data.
- 按[依赖核查](dependency-security.md)复核fflate 0.8.3及SDK 1.31.0、完整audit、ZIP64回归与正常归档一致性证据。不可在相同版本下覆盖已审字节。
- 配置GitHub private vulnerability reporting或已验证的私密联系方式，更新SECURITY.md。不要发布不存在的邮箱或承诺响应时限。
- Approve a **developer preview** with explicit RC/host limitations. Actual RC completion is not a prerequisite for a truthfully scoped preview, but unresolved security findings require their own decision and handling.

## Review the exact local candidate / 审查准确的本地候选

在源码根目录确认身份，以下命令只执行本地检查：

```sh
PROJECT_ROOT="$(pwd -P)"
node -e 'const p=require("./package.json"); if(p.name!=="codex-jlc-eda") process.exit(1)'
npm --prefix "$PROJECT_ROOT" ci --ignore-scripts --no-audit --no-fund
npm --prefix "$PROJECT_ROOT" test
npm --prefix "$PROJECT_ROOT" run test:protocol
node scripts/check-docs.mjs
node scripts/audit-release.mjs
npm --prefix "$PROJECT_ROOT" audit --json
npm --prefix "$PROJECT_ROOT" run package
```

audit非零需要逐项处理，不能只使用`--omit=dev`。fflate/SDK均以devDependencies声明，但其代码确实参与runtime打包。依赖变更要重新检查实际构建图，而非依赖分类标签。

检查`release-files.json`、`git diff --cached`与未暂存内容。只暂存已审文件，确认没有私人绝对路径、凭据、完整日志、原生数据和无许可附件。分别查看两种README渲染及语言链接，不能用截图或徽章替代测试证据。

`release/<version>/`包含两个ZIP、SHA256SUMS及成员清单。把两个ZIP都放在校验目录后运行`shasum -a 256 -c SHA256SUMS`。在新目录解包runtime，用源码侧`node scripts/verify-package.mjs <runtime-root> --runtime`核对公共协议。源码包不含dist；GitHub自动生成的Source code归档也不是运行包。

## Publication commands — only after approval / 批准后才执行

下面的命令会创建公开仓库、推送并建立Release，**本轮不执行**。由发布者先设置`OWNER=aning0922`、真实`AUTHOR_NAME`、`AUTHOR_EMAIL`与`RELEASE_APPROVED=yes`。保持当前版本与已审资产一致；本轮版本为0.11.0-alpha.3。

```sh
: "${OWNER:?Set the confirmed GitHub owner}"
: "${AUTHOR_NAME:?Set the verified commit author}"
: "${AUTHOR_EMAIL:?Set the verified commit email}"
[ "${RELEASE_APPROVED:-no}" = yes ] || exit 1
REPO=codex-jlc-eda
VERSION="$(node -p 'require("./package.json").version')"
ASSET_DIR="release/$VERSION"
test -f "$ASSET_DIR/SHA256SUMS" || exit 1
# Stage only reviewed paths, then inspect this output before committing.
git diff --cached --stat
git -c user.name="$AUTHOR_NAME" -c user.email="$AUTHOR_EMAIL" commit -m "Prepare $VERSION developer preview"
gh repo create "$OWNER/$REPO" --public --source . --remote origin
git push -u origin main
git tag "v$VERSION"
git push origin "v$VERSION"
gh release create "v$VERSION" \
  "$ASSET_DIR/codex-jlc-eda-$VERSION-source.zip" \
  "$ASSET_DIR/codex-jlc-eda-$VERSION-runtime.zip" \
  "$ASSET_DIR/SHA256SUMS" \
  "$ASSET_DIR/source-manifest.json" \
  "$ASSET_DIR/runtime-manifest.json" \
  "$ASSET_DIR/packages.json" \
  --repo "$OWNER/$REPO" --verify-tag --prerelease --draft \
  --title "$VERSION — Developer preview" \
  --notes-file "docs/releases/$VERSION.en.md"
```

Review the draft, add the Chinese notes, and verify downloadable asset hashes before publishing it. 明确保留Pre-release标记，不冒称远端CI已通过；初次push后实际查看Actions结果。设置仓库简介/topics见`repository-metadata.json`。开启适用的依赖图、Dependabot告警、秘密扫描和推送保护，限制写权限与CI token权限。

本仓库源码Git marketplace需要先构建，不提供假定可用的`owner/repo`零构建安装快捷指令。发布后再添加真实Release/Issue链接，避免在准备阶段制造失效下载入口。[GitHub Release guidance](https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository)
