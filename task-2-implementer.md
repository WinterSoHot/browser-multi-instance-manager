# Task 2：系统托盘实现报告

## 交付内容

- 新增 `lib/tray-manager.js`：注入式托盘管理器，支持幂等创建、刷新、去抖刷新与销毁。
- 菜单展示已脱敏的运行/未知数量、工作区收藏分组、未分组收藏项、20 项直显上限、主界面入口和安全退出入口。
- 收藏启动在单飞保护下取得一次强制批量状态快照；运行/未知项不会启动，其他项最多四并发，底层错误不会透出托盘边界。
- `main.js` 装配 Task1 生命周期：关闭窗口、`before-quit`、macOS Dock 激活、托盘双击和 Windows `window-all-closed` 均使用同一安全退出/窗口恢复路径。
- 退出确认显示运行与未知数量，并明确“只退出管理器，不关闭浏览器”。元数据和进程状态变化会去抖刷新托盘。

## 资源检查

`build/icons/icon.png` 已检查为可读的 2048×2048 RGBA PNG，因此没有修改图标。macOS 托盘图标会缩放为 16×16 并标记为 template image。

## 验证

- `node --test test/tray-manager.test.js test/main-tray-wiring.test.js`
- `node --check main.js && node --check lib/tray-manager.js`
- `npm test`：270 项测试通过，0 失败。
- `git diff --check`：通过。
