import * as vscode from 'vscode';
import * as https from 'https';

interface QuotaLimit {
    type: string;
    unit: number;
    number: number;
    usage?: number;
    currentValue?: number;
    remaining?: number;
    percentage: number;
    nextResetTime: number;
    usageDetails?: { modelCode: string; usage: number }[];
}

interface QuotaResponse {
    code: number;
    msg: string;
    data: {
        limits: QuotaLimit[];
        level: string;
    };
    success: boolean;
}

let statusBarItem: vscode.StatusBarItem;
let refreshInterval: NodeJS.Timeout | undefined;

export function activate(context: vscode.ExtensionContext) {
    // 创建状态栏项
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.command = 'zhipu-quota.refresh';
    statusBarItem.tooltip = '点击刷新智谱API配额';
    context.subscriptions.push(statusBarItem);

    // 注册刷新命令
    const refreshCommand = vscode.commands.registerCommand('zhipu-quota.refresh', () => {
        fetchAndDisplayQuota();
    });

    // 注册设置API Key命令
    const setApiKeyCommand = vscode.commands.registerCommand('zhipu-quota.setApiKey', async () => {
        const apiKey = await vscode.window.showInputBox({
            prompt: '请输入智谱API Key',
            password: true,
            placeHolder: '例如：xxx.xxx'
        });
        if (apiKey) {
            const config = vscode.workspace.getConfiguration('zhipuQuota');
            await config.update('apiKey', apiKey, vscode.ConfigurationTarget.Global);
            vscode.window.showInformationMessage('智谱API Key已保存');
            fetchAndDisplayQuota();
        }
    });

    context.subscriptions.push(refreshCommand);
    context.subscriptions.push(setApiKeyCommand);

    // 监听配置变化
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('zhipuQuota.refreshInterval')) {
                setupRefreshInterval();
            }
        })
    );

    // 初始化
    statusBarItem.text = '$(sync~spin) 智谱API...';
    statusBarItem.show();
    fetchAndDisplayQuota();
    setupRefreshInterval();
}

function setupRefreshInterval() {
    if (refreshInterval) {
        clearInterval(refreshInterval);
    }
    const config = vscode.workspace.getConfiguration('zhipuQuota');
    const intervalSeconds = config.get<number>('refreshInterval', 300);
    refreshInterval = setInterval(fetchAndDisplayQuota, intervalSeconds * 1000);
}

async function fetchAndDisplayQuota() {
    const config = vscode.workspace.getConfiguration('zhipuQuota');
    const apiKey = config.get<string>('apiKey', '');

    if (!apiKey) {
        statusBarItem.text = '$(key) 智谱API: 未设置Key';
        statusBarItem.tooltip = '点击设置智谱API Key';
        statusBarItem.command = 'zhipu-quota.setApiKey';
        return;
    }

    statusBarItem.command = 'zhipu-quota.refresh';

    try {
        const data = await fetchQuota(apiKey);

        if (data.success && data.data.limits) {
            updateStatusBar(data.data.limits);
        } else {
            statusBarItem.text = '$(error) 智谱API: 获取失败';
            statusBarItem.tooltip = `错误: ${data.msg}`;
        }
    } catch (error) {
        statusBarItem.text = '$(error) 智谱API: 请求错误';
        statusBarItem.tooltip = `${error}`;
    }
}

function fetchQuota(apiKey: string): Promise<QuotaResponse> {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'bigmodel.cn',
            path: '/api/monitor/usage/quota/limit',
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    reject(new Error('JSON解析失败'));
                }
            });
        });

        req.on('error', (e) => { reject(e); });
        req.setTimeout(10000, () => {
            req.destroy();
            reject(new Error('请求超时'));
        });
        req.end();
    });
}

function updateStatusBar(limits: QuotaLimit[]) {
    // 查找Token限制
    const tokenLimit = limits.find(l => l.type === 'TOKENS_LIMIT');

    if (tokenLimit) {
        const percentage = tokenLimit.percentage;
        const nextReset = formatDate(tokenLimit.nextResetTime);

        // 根据使用率选择图标
        let icon = '$(check)';
        if (percentage > 80) {
            icon = '$(alert)';
        } else if (percentage > 50) {
            icon = '$(warning)';
        }

        statusBarItem.text = `${icon} 智谱: ${percentage}%`;

        let tooltip = `**智谱API配额**\n\n`;
        tooltip += `- **Token使用率**: ${percentage}%\n`;
        tooltip += `- **下次重置**: ${nextReset}\n`;
        tooltip += `\n---\n点击刷新`;
        statusBarItem.tooltip = new vscode.MarkdownString(tooltip);
    } else {
        statusBarItem.text = '$(question) 智谱: 无数据';
    }
}

function formatDate(timestamp: number): string {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = date.getTime() - now.getTime();

    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

    if (days > 0) {
        return `${date.getMonth() + 1}月${date.getDate()}日 (${days}天${hours}小时后)`;
    } else if (hours > 0) {
        return `${hours}小时${minutes}分钟后`;
    } else {
        return `${minutes}分钟后`;
    }
}

export function deactivate() {
    if (refreshInterval) {
        clearInterval(refreshInterval);
    }
    if (statusBarItem) {
        statusBarItem.dispose();
    }
}
