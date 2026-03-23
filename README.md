# 智谱API配额监控

在 VSCode 状态栏显示智谱 API 的使用率和下次重置时间。

## 功能

- 状态栏实时显示 Token 使用率
- 鼠标悬停查看详细信息
- 自动定时刷新（默认5分钟）
- 点击状态栏手动刷新

## 使用方法

1. 安装插件后，按 `Ctrl+Shift+P` 打开命令面板
2. 输入 `Zhipu: Set API Key`
3. 粘贴你的 API Key
4. 状态栏右下角会显示使用率

## 配置

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| `zhipuQuota.apiKey` | 智谱API密钥 | - |
| `zhipuQuota.refreshInterval` | 刷新间隔（秒） | 300 |

## 命令

- `Zhipu: Refresh Quota` - 手动刷新配额信息
- `Zhipu: Set API Key` - 设置API密钥
