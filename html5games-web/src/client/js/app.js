// DOM 元素
const elements = {
    totalGames: document.getElementById('total-games'),
    lastUpdate: document.getElementById('last-update'),
    collectStatus: document.getElementById('collect-status'),
    downloadJson: document.getElementById('download-json'),
    downloadPackage: document.getElementById('download-package'),
    jsonCount: document.getElementById('json-count'),
    fullCount: document.getElementById('full-count'),
    lastStart: document.getElementById('last-start'),
    lastEnd: document.getElementById('last-end'),
    lastError: document.getElementById('last-error'),
    progressContainer: document.querySelector('.progress-section'),
    progressBar: document.querySelector('.progress-bar'),
    progressText: document.querySelector('.progress-text')
};

// 状态更新间隔（毫秒）
const STATUS_UPDATE_INTERVAL = 2000;

// 格式化日期时间
function formatDateTime(dateStr) {
    if (!dateStr) return '未知';
    try {
        const date = new Date(dateStr);
        return date.toLocaleString('zh-CN', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
        });
    } catch (error) {
        console.error('日期格式化失败:', error);
        return '未知';
    }
}

// 更新进度条
function updateProgress(progress) {
    if (!progress) {
        elements.progressBar.style.width = '0%';
        elements.progressText.textContent = '未在采集';
        return;
    }

    let displayProgress = 0;
    let displayText = '';

    switch (progress.stage) {
        case '初始化':
            displayProgress = progress.stageProgress;
            displayText = '初始化中...';
            break;
        case '获取游戏列表':
            displayProgress = progress.stageProgress;
            displayText = `获取游戏列表 (${Math.floor(progress.stageProgress)}%)`;
            break;
        case '采集游戏数据':
            displayProgress = progress.stageProgress;
            displayText = `采集游戏数据 ${progress.current}/${progress.total} (${Math.floor(progress.stageProgress)}%)`;
            break;
        case '生成数据包':
            displayProgress = progress.stageProgress;
            displayText = `生成数据包 (${Math.floor(progress.stageProgress)}%)`;
            break;
        case '更新数据库':
            displayProgress = progress.stageProgress;
            displayText = `更新数据库 (${Math.floor(progress.stageProgress)}%)`;
            elements.collectStatus.textContent = '更新中';
            elements.collectStatus.className = 'status updating';
            break;
        case '更新完成':
            displayProgress = 100;
            displayText = '更新完成';
            break;
        case '完成':
            displayProgress = 100;
            displayText = '采集完成';
            break;
        case '错误':
            displayProgress = 0;
            displayText = '采集出错';
            break;
        default:
            displayProgress = 0;
            displayText = progress.stage;
    }

    elements.progressBar.style.width = `${displayProgress}%`;
    elements.progressText.textContent = displayText;
}

// 更新状态显示
function updateStatus(status) {
    // 更新游戏总数
    elements.totalGames.textContent = status.total_games || '0';

    // 更新最后更新时间
    elements.lastUpdate.textContent = status.last_collection_end ? 
        formatDateTime(status.last_collection_end) : '未知';

    // 更新采集状态
    if (status.is_collecting) {
        elements.collectStatus.textContent = '采集中';
        elements.collectStatus.className = 'status collecting';
        elements.progressContainer.style.display = 'block';
        disableDownloadButtons(true);
    } else {
        elements.collectStatus.textContent = '空闲';
        elements.collectStatus.className = 'status idle';
        elements.progressContainer.style.display = 'none';
        
        // 检查数据是否可下载
        checkDownloadAvailability();
    }

    // 更新系统信息
    elements.lastStart.textContent = status.last_collection_start ? 
        formatDateTime(status.last_collection_start) : '未知';
    elements.lastEnd.textContent = status.last_collection_end ? 
        formatDateTime(status.last_collection_end) : '未知';
    elements.lastError.textContent = status.last_collection_error || '无';
}

// 检查数据是否可下载
async function checkDownloadAvailability() {
    try {
        const response = await fetch('/api/status/download');
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || '检查下载状态失败');
        }

        // 更新下载按钮状态
        elements.downloadJson.disabled = !data.json_ready;
        elements.downloadPackage.disabled = !data.package_ready;

        if (!elements.downloadJson.disabled) {
            elements.downloadJson.classList.remove('loading');
        }
        if (!elements.downloadPackage.disabled) {
            elements.downloadPackage.classList.remove('loading');
        }
    } catch (error) {
        console.error('检查下载状态失败:', error);
        // 出错时禁用下载按钮
        elements.downloadJson.disabled = true;
        elements.downloadPackage.disabled = true;
    }
}

// 开始采集
async function startCollection() {
    try {
        const response = await fetch('/api/collect', {
            method: 'POST'
        });
        const result = await response.json();
        
        if (!result.success) {
            throw new Error(result.error);
        }

        if (!result.should_collect) {
            alert('距离上次采集未超过1小时，暂不需要重新采集');
        }
    } catch (error) {
        console.error('启动采集失败:', error);
        alert('启动采集失败: ' + error.message);
    }
}

// 下载 JSON 数据
async function downloadJson() {
    try {
        window.location.href = '/api/download/json';
    } catch (error) {
        console.error('下载 JSON 失败:', error);
        alert('下载 JSON 失败: ' + error.message);
    }
}

// 下载完整数据包
async function downloadPackage() {
    try {
        window.location.href = '/api/download/package';
    } catch (error) {
        console.error('下载数据包失败:', error);
        alert('下载数据包失败: ' + error.message);
    }
}

// 定期更新状态
async function updateStatusPeriodically() {
    try {
        const response = await fetch('/api/status');
        const status = await response.json();
        updateStatus(status);
    } catch (error) {
        console.error('获取状态失败:', error);
    }
}

// 禁用/启用下载按钮
function disableDownloadButtons(disabled) {
    elements.downloadJson.disabled = disabled;
    elements.downloadPackage.disabled = disabled;
    
    if (disabled) {
        elements.downloadJson.classList.add('loading');
        elements.downloadPackage.classList.add('loading');
    }
}

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', () => {
    // 绑定按钮事件
    
    document.getElementById('download-json').addEventListener('click', downloadJson);
    document.getElementById('download-package').addEventListener('click', downloadPackage);

    // 立即更新一次状态
    updateStatusPeriodically();

    // 设置定期更新
    setInterval(updateStatusPeriodically, STATUS_UPDATE_INTERVAL);
}); 