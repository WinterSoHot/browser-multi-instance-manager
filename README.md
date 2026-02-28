# 浏览器多实例管理器

桌面应用程序，支持同时打开多个浏览器窗口，每个窗口使用不同的用户配置文件。

## 功能特性

- 支持 Chrome、Firefox、Microsoft Edge 浏览器
- 添加/重命名/删除浏览器配置
- 一键启动浏览器并使用指定配置
- 打开配置文件夹
- 配置持久化存储

## 技术栈

- Electron
- electron-store

## 使用方法

### 安装依赖

```bash
npm install
```

### 启动应用

```bash
npm start
```

### 使用说明

1. 点击"添加新配置"，选择浏览器类型并输入配置名称
2. 点击"启动"按钮，使用对应配置打开浏览器
3. 点击"文件夹"可在 Finder 中查看配置数据
4. 点击"重命名"修改配置名称
5. 点击"删除"移除配置

## 项目结构

```
.
├── main.js           # Electron 主进程
├── preload.js        # 预加载脚本
├── package.json      # 项目配置
├── .gitignore        # Git 忽略配置
└── renderer/
    ├── index.html    # 主界面
    ├── styles.css    # 样式
    └── renderer.js   # 渲染进程逻辑
```

## 构建安装包

### 构建 macOS DMG

```bash
npm run build:mac
```

### 构建 Windows EXE

```bash
npm run build:win
```

### 构建所有平台

```bash
npm run build:all
```

构建完成后，安装包位于 `dist/` 目录下。

## 平台

- macOS
- Windows (需要 Windows 系统构建)