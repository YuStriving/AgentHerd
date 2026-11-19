<!--
标题用英文 / Title in English: `type(scope): what the owner sees`
type: feat | fix | docs | refactor | test | chore | build | ci | perf
fix 写现象和触发条件，不写实现 / For a fix, name the symptom and its trigger, not the code change:
  好 / Good: fix(pet): the pet jumps back after a drag at 150 % scaling
  不好 / Bad:  fix(pet): use getCursorScreenPoint in drag handler
正文中文或英文都可以；不适用的小节写「无 / None」，不要删。
Write the body in Chinese or English. Write "无 / None" in a section that does not apply; do not delete it.
-->

## 关联 / Related

<!-- Closes #N 或 Refs #N；没有 issue 写「无」/ Closes #N or Refs #N, or "None" -->

## 为什么 / Why

<!-- 解决什么问题，改完后用户看到什么。一两句。/ The problem and what the owner sees after the change. One or two sentences. -->

## 改了什么 / What changed

<!-- 3–6 条，按行为写，不罗列文件。/ 3–6 bullets about behavior, not a file list. -->

-

## 文档同步 / Docs in sync

<!-- 按 AGENTS.md「Docs stay in sync with code」勾选；不适用的勾「不需要」并写原因。/ Per AGENTS.md; tick "not needed" with a reason when one does not apply. -->

- [ ] spec 页 / Spec page:
- [ ] ADR（含索引 / with the index）:
- [ ] E2E 场景（`docs/spec/07-delivery.md`）和测试 / E2E scenario and its test:
- [ ] `README.md` 与 `README.zh-CN.md` 一起改 / changed together
- [ ] 不需要，原因 / Not needed, because:

## 风险 / Risk

<!-- 动到下列任何一项就勾上，并说明为什么仍然安全。/ Tick any you touched and say why it stays safe. -->

- [ ] 守卫列表、规则、审批或「出错交给人」/ Guard list, rules, approvals or fail-toward-the-human
- [ ] `packages/protocol` 合约 / contract
- [ ] 密钥、日志、herd.db 内容 / Secrets, logs, herd.db content
- [ ] Agent 配置导出 / Agent config export
- [ ] 以上都没有 / None of these

## 验证 / Verification

<!--
只写实际运行过的命令或操作。跳过、失败、没运行都如实写，不能写成通过。
List only what you actually ran. Write skipped, failed or not run as such; never as passed.
-->

| 检查 / Check | 结果 / Result | 环境 / Environment |
| --- | --- | --- |
| `pnpm check` | | |
| `pnpm test`（或指定的测试文件 / or named test files） | | |
| 真实飞书 / Real Feishu | | |
| 桌面 App 手动 / Desktop app by hand | | |

<!-- 界面改动附截图或录屏，先遮盖隐私。/ For UI changes, attach a screenshot or recording with private data hidden. -->

## AI 参与 / AI use

<!-- 用了哪个 Agent 和模型，哪些部分由人看过。/ Which agent and model, and which parts a human reviewed. -->
