// DOM 元素
const elements = {
    concurrentSlider: document.getElementById('concurrentSlider'),
    concurrentValue: document.getElementById('concurrentValue'),
    concurrentWarning: document.getElementById('concurrentWarning'),
    startBtn: document.getElementById('startBtn'),
    toggleSidebarBtn: document.getElementById('toggleSidebarBtn'),
    closeSidebarBtn: document.getElementById('closeSidebarBtn'),
    sidebar: document.getElementById('sidebar'),
    logContainer: document.getElementById('logContainer'),
    downloadJsonBtn: document.getElementById('downloadJsonBtn'),
    downloadFullBtn: document.getElementById('downloadFullBtn'),
    downloadProgress: document.getElementById('downloadProgress'),
    progressBar: document.getElementById('progressBar'),
    progressText: document.getElementById('progressText'),
    totalGames: document.getElementById('totalGames'),
    lastUpdate: document.getElementById('lastUpdate'),
    jsonCount: document.getElementById('jsonCount'),
    fullCount: document.getElementById('fullCount')
};

// 状态管理
const state = {
    isCollecting: false,
    isSidebarOpen: false,
    lastGameData: null
};

// 并发数滑块处理
elements.concurrentSlider.addEventListener('input', (e) => {
    const value = e.target.value;
    elements.concurrentValue.textContent = value;
    elements.concurrentWarning.classList.toggle('hidden', value <= 30);
});

// 侧边栏控制
elements.toggleSidebarBtn.addEventListener('click', toggleSidebar);
elements.closeSidebarBtn.addEventListener('click', toggleSidebar);

// 点击非侧边栏区域关闭侧边栏
document.addEventListener('click', (e) => {
    if (state.isSidebarOpen && 
        !elements.sidebar.contains(e.target) && 
        !elements.toggleSidebarBtn.contains(e.target)) {
        toggleSidebar();
    }
});

function toggleSidebar() {
    state.isSidebarOpen = !state.isSidebarOpen;
    elements.sidebar.style.transform = state.isSidebarOpen ? 'translateX(0)' : 'translateX(100%)';
    elements.toggleSidebarBtn.textContent = state.isSidebarOpen ? '隐藏日志' : '显示日志';
}

// 添加日志
function addLog(message, type = 'info') {
    const logItem = document.createElement('div');
    logItem.className = 'log-item';
    logItem.innerHTML = `
        <span class="text-xs text-gray-400">${new Date().toLocaleTimeString()}</span>
        <span class="ml-2 ${type === 'error' ? 'text-red-500' : ''}">${message}</span>
    `;
    elements.logContainer.appendChild(logItem);
    elements.logContainer.scrollTop = elements.logContainer.scrollHeight;
}

// 更新进度条
function updateProgress(percent, text) {
    elements.downloadProgress.classList.remove('hidden');
    elements.progressBar.style.width = `${percent}%`;
    elements.progressText.textContent = text;
}

// 隐藏进度条
function hideProgress() {
    elements.downloadProgress.classList.add('hidden');
    elements.progressBar.style.width = '0%';
    elements.progressText.textContent = '准备下载...';
}

// 开始采集
elements.startBtn.addEventListener('click', async () => {
    if (state.isCollecting) return;
    
    state.isCollecting = true;
    elements.startBtn.disabled = true;
    elements.downloadJsonBtn.disabled = true;
    elements.downloadFullBtn.disabled = true;
    hideProgress();
    
    const concurrent = elements.concurrentSlider.value;
    addLog(`开始采集数据，并发数：${concurrent}`);
    
    try {
        const response = await fetch('/api/collect', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ concurrent })
        });
        
        if (!response.ok) throw new Error('采集请求失败');
        
        const data = await response.json();
        if (!data.success) {
            throw new Error(data.error || '采集失败');
        }
        
        addLog('采集任务已启动，请等待完成...');
    } catch (error) {
        addLog(error.message, 'error');
        state.isCollecting = false;
        elements.startBtn.disabled = false;
    }
});

// 下载 JSON 数据
elements.downloadJsonBtn.addEventListener('click', async () => {
    try {
        addLog('开始下载 JSON 数据');
        updateProgress(0, '准备下载...');
        
        const response = await fetch('/api/download/json');
        if (!response.ok) throw new Error('下载失败');
        
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `html5games_${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
        
        updateProgress(100, '下载完成！');
        setTimeout(hideProgress, 2000);
        
        // 更新下载计数
        elements.jsonCount.textContent = parseInt(elements.jsonCount.textContent) + 1;
        addLog('JSON 数据下载完成');
    } catch (error) {
        addLog(error.message, 'error');
        hideProgress();
    }
});

// 下载完整数据包
elements.downloadFullBtn.addEventListener('click', async () => {
    try {
        addLog('开始下载完整数据包');
        updateProgress(0, '准备下载...');
        
        const response = await fetch('/api/download/full');
        if (!response.ok) throw new Error('下载失败');
        
        const reader = response.body.getReader();
        const contentLength = +response.headers.get('Content-Length');
        
        let receivedLength = 0;
        const chunks = [];
        
        while(true) {
            const {done, value} = await reader.read();
            
            if (done) break;
            
            chunks.push(value);
            receivedLength += value.length;
            
            const percent = (receivedLength / contentLength) * 100;
            updateProgress(percent, `下载中... ${Math.round(percent)}%`);
        }
        
        const blob = new Blob(chunks);
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `html5games_full_${new Date().toISOString().split('T')[0]}.zip`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
        
        updateProgress(100, '下载完成！');
        setTimeout(hideProgress, 2000);
        
        // 更新下载计数
        elements.fullCount.textContent = parseInt(elements.fullCount.textContent) + 1;
        addLog('完整数据包下载完成');
    } catch (error) {
        addLog(error.message, 'error');
        hideProgress();
    }
});

// 检查状态
async function checkStatus() {
    try {
        const response = await fetch('/api/status');
        if (!response.ok) return;
        
        const data = await response.json();
        
        // 更新采集状态
        const wasCollecting = state.isCollecting;
        state.isCollecting = data.isCollecting || false;
        
        // 更新进度
        if (state.isCollecting && data.progress) {
            const percent = (data.progress.current / data.progress.total) * 100;
            const progressText = `正在采集 ${data.progress.current}/${data.progress.total}`;
            updateProgress(percent, progressText);
            
            // 只在进度变化时添加日志
            if (data.progress.current % 50 === 0) {  // 每50个添加一次日志
                addLog(progressText);
            }
            
            elements.startBtn.disabled = true;
            elements.downloadJsonBtn.disabled = true;
            elements.downloadFullBtn.disabled = true;
        } else {
            if (wasCollecting && !state.isCollecting) {
                // 采集刚刚完成
                hideProgress();
                addLog('采集任务完成！');
            }
            
            // 重置按钮状态
            elements.startBtn.disabled = false;
            
            // 如果有数据，启用下载按钮
            const hasData = data.data?.totalGames > 0;
            elements.downloadJsonBtn.disabled = !hasData;
            elements.downloadFullBtn.disabled = !hasData;
        }
        
        // 更新显示数据
        if (data.data) {
            elements.totalGames.textContent = data.data.totalGames || 0;
            if (data.data.lastUpdate) {
                elements.lastUpdate.textContent = new Date(data.data.lastUpdate).toLocaleString();
            }
            elements.jsonCount.textContent = data.data.downloads?.json || 0;
            elements.fullCount.textContent = data.data.downloads?.full || 0;
        }
    } catch (error) {
        console.error('状态检查失败:', error);
    }
}

// 初始化：获取最新数据状态
async function initialize() {
    try {
        const response = await fetch('/api/status');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        
        // 更新状态显示
        elements.totalGames.textContent = data.data?.totalGames || 0;
        if (data.data?.lastUpdate) {
            elements.lastUpdate.textContent = new Date(data.data.lastUpdate).toLocaleString();
        }
        elements.jsonCount.textContent = data.data?.downloads?.json || 0;
        elements.fullCount.textContent = data.data?.downloads?.full || 0;

        // 更新采集状态
        state.isCollecting = data.isCollecting || false;
        
        // 设置按钮状态
        const hasData = data.data?.totalGames > 0;
        elements.startBtn.disabled = state.isCollecting;
        elements.downloadJsonBtn.disabled = !hasData;
        elements.downloadFullBtn.disabled = !hasData;
        
        // 如果正在采集，显示进度
        if (state.isCollecting && data.progress) {
            const percent = (data.progress.current / data.progress.total) * 100;
            updateProgress(percent, `正在采集 ${data.progress.current}/${data.progress.total}`);
            addLog(`采集进行中: ${data.progress.current}/${data.progress.total}`);
        } else {
            hideProgress();
        }

        // 定期检查状态
        setInterval(checkStatus, 5000);
        
        // 初始化成功日志
        addLog('系统初始化完成');
    } catch (error) {
        console.error('初始化失败:', error);
        addLog(`初始化失败: ${error.message}`, 'error');
        // 确保按钮可用
        elements.startBtn.disabled = false;
        elements.downloadJsonBtn.disabled = true;
        elements.downloadFullBtn.disabled = true;
    }
}

// 移除重复的初始化调用
initialize(); 