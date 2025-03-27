const translations = {
    'zh-CN': {
        title: 'HTML5Games 数据采集',
        systemStatus: '系统状态',
        totalGames: '游戏总数',
        lastUpdate: '最后更新',
        collectStatus: '采集状态',
        dataDownload: '数据下载',
        downloadJsonBtn: '下载 JSON 数据',
        downloadPackageBtn: '下载完整数据包',
        systemInfo: '系统信息',
        lastCollectStart: '上次采集开始',
        lastCollectEnd: '上次采集结束',
        lastError: '上次错误信息',
        preparing: '准备中...',
        unknown: '未知',
        none: '无',
        idle: '空闲',
        collecting: '采集中',
        language: '语言'
    },
    'en-US': {
        title: 'HTML5Games Data Collection',
        systemStatus: 'System Status',
        totalGames: 'Total Games',
        lastUpdate: 'Last Update',
        collectStatus: 'Collection Status',
        dataDownload: 'Data Download',
        downloadJsonBtn: 'Download JSON Data',
        downloadPackageBtn: 'Download Full Package',
        systemInfo: 'System Information',
        lastCollectStart: 'Last Collection Start',
        lastCollectEnd: 'Last Collection End',
        lastError: 'Last Error',
        preparing: 'Preparing...',
        unknown: 'Unknown',
        none: 'None',
        idle: 'Idle',
        collecting: 'Collecting',
        language: 'Language'
    }
};

// 获取浏览器语言
const getBrowserLanguage = () => {
    const lang = navigator.language || navigator.userLanguage;
    return translations[lang] ? lang : 'en-US';
};

// 获取当前语言
const getCurrentLanguage = () => {
    return localStorage.getItem('language') || getBrowserLanguage();
};

// 设置语言
const setLanguage = (lang) => {
    if (!translations[lang]) return;
    localStorage.setItem('language', lang);
    updatePageTranslations();
};

// 更新页面翻译
const updatePageTranslations = () => {
    const currentLang = getCurrentLanguage();
    const t = translations[currentLang];

    // 更新页面上的所有文本
    document.title = t.title;
    document.querySelector('header h1').textContent = t.title;
    document.querySelector('.status-section h2').textContent = t.systemStatus;
    document.querySelector('.download-section h2').textContent = t.dataDownload;
    document.querySelector('.system-section h2').textContent = t.systemInfo;

    // 更新标签文本
    document.querySelectorAll('[data-i18n]').forEach(element => {
        const key = element.getAttribute('data-i18n');
        if (t[key]) {
            element.textContent = t[key];
        }
    });

    // 更新按钮文本
    document.querySelector('#download-json').childNodes[0].textContent = t.downloadJsonBtn;
    document.querySelector('#download-package').childNodes[0].textContent = t.downloadPackageBtn;

    // 更新状态文本
    if (document.querySelector('#collect-status').textContent === '空闲') {
        document.querySelector('#collect-status').textContent = t.idle;
    } else if (document.querySelector('#collect-status').textContent === '采集中') {
        document.querySelector('#collect-status').textContent = t.collecting;
    }

    // 更新其他默认值
    if (document.querySelector('#last-update').textContent === '未知') {
        document.querySelector('#last-update').textContent = t.unknown;
    }
    if (document.querySelector('#last-start').textContent === '未知') {
        document.querySelector('#last-start').textContent = t.unknown;
    }
    if (document.querySelector('#last-end').textContent === '未知') {
        document.querySelector('#last-end').textContent = t.unknown;
    }
    if (document.querySelector('#last-error').textContent === '无') {
        document.querySelector('#last-error').textContent = t.none;
    }
    if (document.querySelector('.progress-text').textContent === '准备中...') {
        document.querySelector('.progress-text').textContent = t.preparing;
    }
};

export { getCurrentLanguage, setLanguage, updatePageTranslations }; 