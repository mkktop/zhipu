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

interface ModelUsageResponse {
    code: number;
    success: boolean;
    data: {
        totalUsage?: {
            totalModelCallCount: number;
            totalTokensUsage: number;
        };
        total_usage?: {
            totalModelCallCount: number;
            totalTokensUsage: number;
        };
    };
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

interface CumulativeData {
    lastDate: string;
    cumulativeUsage: number;
}

let statusBarItem: vscode.StatusBarItem;
let refreshInterval: NodeJS.Timeout | undefined;
let extensionContext: vscode.ExtensionContext;

export function activate(context: vscode.ExtensionContext) {
    extensionContext = context;
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

    // 注册设置刷新间隔命令
    const setRefreshIntervalCommand = vscode.commands.registerCommand('zhipu-quota.setRefreshInterval', async () => {
        const config = vscode.workspace.getConfiguration('zhipuQuota');
        const currentInterval = config.get<number>('refreshInterval', 300);

        const input = await vscode.window.showInputBox({
            prompt: '请输入刷新间隔（秒）',
            placeHolder: '例如：300（5分钟）',
            value: String(currentInterval),
            validateInput: (value) => {
                const num = parseInt(value);
                if (isNaN(num) || num < 10) {
                    return '请输入大于10的数字';
                }
                return null;
            }
        });

        if (input) {
            const newInterval = parseInt(input);
            await config.update('refreshInterval', newInterval, vscode.ConfigurationTarget.Global);
            vscode.window.showInformationMessage(`刷新间隔已设置为 ${newInterval} 秒`);
        }
    });

    // 注册清除累计用量命令
    const resetCumulativeCommand = vscode.commands.registerCommand('zhipu-quota.resetCumulative', async () => {
        const confirm = await vscode.window.showWarningMessage(
            '确定要清除累计Token用量吗？',
            { modal: true },
            '确定'
        );
        if (confirm === '确定') {
            await extensionContext.globalState.update('zhipuQuota.cumulativeData', undefined);
            vscode.window.showInformationMessage('累计Token用量已清除');
            fetchAndDisplayQuota();
        }
    });

    // 注册切换Token显示单位命令
    const setTokenUnitCommand = vscode.commands.registerCommand('zhipu-quota.setTokenUnit', async () => {
        const config = vscode.workspace.getConfiguration('zhipuQuota');
        const currentUnit = config.get<string>('tokenUnit', 'auto');
        const options = ['auto', 'raw', 'K', 'M', 'B', '万', '亿'];
        const labels = ['自动', '无单位（原始数值）', 'K（千）', 'M（百万）', 'B（十亿）', '万（一万）', '亿（一亿）'];
        const currentIndex = options.indexOf(currentUnit);

        const items = labels.map((label, i) => ({ label: `${label}${i === currentIndex ? ' ✓' : ''}`, value: options[i] }));
        const picked = await vscode.window.showQuickPick(items, {
            placeHolder: '选择Token显示单位'
        });
        if (picked) {
            const unit = picked.value;
            await config.update('tokenUnit', unit, vscode.ConfigurationTarget.Global);
            vscode.window.showInformationMessage(`Token显示单位已切换为: ${picked.label.replace(' ✓', '')}`);
            fetchAndDisplayQuota();
        }
    });

    context.subscriptions.push(refreshCommand);
    context.subscriptions.push(setApiKeyCommand);
    context.subscriptions.push(setRefreshIntervalCommand);
    context.subscriptions.push(resetCumulativeCommand);
    context.subscriptions.push(setTokenUnitCommand);

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
            // 获取今日Token消耗
            let tokensUsed: number | null = null;
            const now = new Date();
            const bjNow = new Date(now.getTime() + 8 * 3600000);
            const bjMidnight = new Date(Date.UTC(bjNow.getUTCFullYear(), bjNow.getUTCMonth(), bjNow.getUTCDate(), 0, 0, 0));
            const start = new Date(bjMidnight.getTime() - 8 * 3600000);

            try {
                const usage = await fetchModelUsage(apiKey, formatBeijingTime(start), formatBeijingTime(now));
                const total = usage.data?.totalUsage || usage.data?.total_usage;
                if (total) {
                    tokensUsed = total.totalTokensUsage;
                }
            } catch {
                // 此接口失败不影响主流程
            }

            // 累计用量统计
            const bjToday = getBeijingToday();
            const storageKey = 'zhipuQuota.cumulativeData';
            let cumulativeData = extensionContext.globalState.get<CumulativeData>(storageKey);

            if (!cumulativeData) {
                cumulativeData = { lastDate: bjToday, cumulativeUsage: 0 };
                await extensionContext.globalState.update(storageKey, cumulativeData);
            } else if (cumulativeData.lastDate < bjToday) {
                const lastDateMs = parseDateStr(cumulativeData.lastDate);
                const todayMs = parseDateStr(bjToday);
                const diffDays = Math.floor((todayMs - lastDateMs) / (24 * 3600000));

                if (diffDays > 0) {
                    const cappedStartMs = todayMs - 30 * 24 * 3600000;
                    const startMs = Math.max(lastDateMs, cappedStartMs);
                    const bjStart = new Date(startMs + 8 * 3600000);
                    const pad = (n: number) => String(n).padStart(2, '0');
                    const startTime = `${bjStart.getUTCFullYear()}-${pad(bjStart.getUTCMonth() + 1)}-${pad(bjStart.getUTCDate())} 00:00:00`;

                    try {
                        const missingUsage = await fetchModelUsage(apiKey, startTime, bjToday + ' 00:00:00');
                        const missingTotal = missingUsage.data?.totalUsage || missingUsage.data?.total_usage;
                        if (missingTotal) {
                            cumulativeData.cumulativeUsage += missingTotal.totalTokensUsage;
                        }
                        cumulativeData.lastDate = bjToday;
                        await extensionContext.globalState.update(storageKey, cumulativeData);
                    } catch {
                        // 补齐失败不影响主流程，下次再试
                    }
                }
            }

            const totalTokensUsed = tokensUsed !== null
                ? cumulativeData.cumulativeUsage + tokensUsed
                : (cumulativeData.cumulativeUsage > 0 ? cumulativeData.cumulativeUsage : null);

            updateStatusBar(data.data.limits, tokensUsed, totalTokensUsed);
        } else {
            statusBarItem.text = '$(error) 智谱API: 获取失败';
            statusBarItem.tooltip = `错误: ${data.msg}`;
        }
    } catch (error) {
        statusBarItem.text = '$(error) 智谱API: 请求错误';
        statusBarItem.tooltip = `${error}`;
    }
}

function httpsGet(hostname: string, path: string, apiKey: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const req = https.request({
            hostname,
            path,
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            }
        }, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => resolve(data));
        });
        req.on('error', (e) => { reject(e); });
        req.setTimeout(10000, () => {
            req.destroy();
            reject(new Error('请求超时'));
        });
        req.end();
    });
}

function fetchQuota(apiKey: string): Promise<QuotaResponse> {
    return httpsGet('bigmodel.cn', '/api/monitor/usage/quota/limit', apiKey)
        .then(data => JSON.parse(data));
}

function fetchModelUsage(apiKey: string, startTime: string, endTime: string): Promise<ModelUsageResponse> {
    const s = encodeURIComponent(startTime);
    const e = encodeURIComponent(endTime);
    return httpsGet('bigmodel.cn', `/api/monitor/usage/model-usage?startTime=${s}&endTime=${e}`, apiKey)
        .then(data => JSON.parse(data));
}

function formatBeijingTime(date: Date): string {
    const d = new Date(date.getTime() + 8 * 3600000);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

function getBeijingToday(): string {
    const d = new Date(Date.now() + 8 * 3600000);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function parseDateStr(dateStr: string): number {
    const [y, m, d] = dateStr.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
}

function formatTokens(n: number): string {
    const config = vscode.workspace.getConfiguration('zhipuQuota');
    const unit = config.get<string>('tokenUnit', 'auto');

    const formatCompact = (value: number, divisor: number, suffix: string) => {
        const compact = value / divisor;
        const digits = compact >= 10 ? 0 : 1;
        return compact.toFixed(digits).replace(/\.0$/, '') + suffix;
    };

    switch (unit) {
        case 'raw':
            return String(n);
        case 'K':
            return formatCompact(n, 1_000, 'K');
        case 'M':
            return formatCompact(n, 1_000_000, 'M');
        case 'B':
            return formatCompact(n, 1_000_000_000, 'B');
        case '万':
            return formatCompact(n, 10_000, '万');
        case '亿':
            return formatCompact(n, 100_000_000, '亿');
        default: // auto
            if (n >= 100_000_000) {
                return formatCompact(n, 100_000_000, '亿');
            }
            if (n >= 10_000) {
                return formatCompact(n, 10_000, '万');
            }
            return String(n);
    }
}

function updateStatusBar(limits: QuotaLimit[], tokensUsed: number | null, totalTokensUsed: number | null) {
    // 查找Token限制
    const tokenLimit = limits.find(l => l.type === 'TOKENS_LIMIT');

    if (tokenLimit) {
        const percentage = tokenLimit.percentage;
        const nextReset = formatDate(tokenLimit.nextResetTime);

        // 根据使用率选择图标
        let icon = '$(check)';
        if (percentage >= 90) {
            icon = '$(alert)';
        } else if (percentage >= 60) {
            icon = '$(warning)';
        }

        statusBarItem.text = `${icon} 智谱额度 ${percentage}%`;

        let tooltip = `智谱 API 配额\n\n`;
        tooltip += `${buildProgressBar(percentage)}\n`;
        tooltip += `- **5小时额度已用**: ${percentage}%\n`;
        if (typeof tokenLimit.remaining === 'number') {
            tooltip += `- **剩余额度**: ${formatTokens(tokenLimit.remaining)} Token\n`;
        }
        if (tokensUsed !== null) {
            tooltip += `- **今日消耗**: ${formatTokens(tokensUsed)} Token\n`;
        }
        if (totalTokensUsed !== null) {
            tooltip += `- **累计消耗**: ${formatTokens(totalTokensUsed)} Token\n`;
        }
        tooltip += `- **下次重置**: ${nextReset}\n`;
        tooltip += `\n---\n点击刷新配额`;
        const md = new vscode.MarkdownString(tooltip);
        md.supportHtml = true;
        md.isTrusted = true;
        statusBarItem.tooltip = md;
    } else {
        statusBarItem.text = '$(question) 智谱: 无数据';
        statusBarItem.tooltip = '未找到 Token 额度数据，点击刷新';
    }
}

function buildProgressBar(percentage: number): string {
    const width = 160;
    const height = 6;
    const normalizedPercentage = Math.max(0, Math.min(100, percentage));
    const filledWidth = Math.round(width * normalizedPercentage / 100);

    let barColor: string;
    let bgColor: string;
    if (percentage >= 90) {
        barColor = '#f85149';
        bgColor = '#3f1d22';
    } else if (percentage >= 60) {
        barColor = '#d29922';
        bgColor = '#3f3316';
    } else {
        barColor = '#3fb950';
        bgColor = '#193a24';
    }

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="${bgColor}" rx="3"/><rect width="${filledWidth}" height="${height}" fill="${barColor}" rx="3"/></svg>`;
    const encoded = Buffer.from(svg).toString('base64');
    return `![${percentage}%](data:image/svg+xml;base64,${encoded})`;
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
