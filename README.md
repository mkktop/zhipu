# 智谱API配额监控

在 VSCode 状态栏显示智谱 API 的5小时额度使用率和下次重置时间。

## 功能

- **状态栏显示**：右下角实时显示5小时额度使用百分比
- **彩色进度条**：鼠标悬停查看彩色进度条
  - 🟢 绿色：使用率 < 60%
  - 🟡 黄色：使用率 60% ~ 89%
  - 🔴 红色：使用率 ≥ 90%
- **详细信息**：今日Token消耗、累计Token消耗、下次重置时间
- **累计统计**：自动累计每日Token消耗，支持最多补齐30天缺失数据
- **自动刷新**：默认每5分钟自动刷新
- **手动刷新**：点击状态栏手动刷新

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
- `Zhipu: Set Refresh Interval` - 设置刷新间隔
- `Zhipu: Reset Cumulative Usage` - 清除累计Token用量
