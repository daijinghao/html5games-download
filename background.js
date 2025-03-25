// 在service worker激活时设置为活动状态
self.addEventListener('activate', event => {
  console.log('Service Worker 已激活');
  event.waitUntil(clients.claim());
});

// 存储采集状态
let isCollecting = false;
let collectedGames = [];
let currentProgress = { total: 0, current: 0 };
let activeTabs = new Set(); // 存储活动的标签页ID
let gameLinks = [];
let maxConcurrentTabs = 5; // 默认并发数
let startTime = null; // 记录开始时间
let endTime = null; // 记录结束时间

// 初始化时加载保存的数据
async function initializeData() {
  console.log('初始化数据');
  try {
    const result = await chrome.storage.local.get(['collectedGames', 'currentProgress']);
    if (result.collectedGames) {
      collectedGames = result.collectedGames;
      console.log('已加载保存的游戏数据:', collectedGames.length);
    }
    if (result.currentProgress) {
      currentProgress = result.currentProgress;
      console.log('已加载进度:', currentProgress);
    }
  } catch (error) {
    console.error('加载保存的数据时出错:', error);
  }
}

// 在service worker安装时初始化数据
self.addEventListener('install', event => {
  console.log('Service Worker 正在安装');
  event.waitUntil(initializeData());
});

// 保存数据到 chrome.storage
async function saveData() {
  try {
    await chrome.storage.local.set({
      collectedGames,
      currentProgress
    });
    console.log('数据已保存');
  } catch (error) {
    console.error('保存数据时出错:', error);
  }
}

// 重置所有数据
async function resetAll() {
  console.log('重置所有数据');
  isCollecting = false;
  collectedGames = [];
  currentProgress = { total: 0, current: 0 };
  gameLinks = [];
  startTime = null;
  endTime = null;
  
  // 清理所有标签页
  await cleanupTabs();
  
  // 清除存储的数据
  try {
    await chrome.storage.local.clear();
    console.log('存储数据已清除');
  } catch (error) {
    console.error('清除存储数据时出错:', error);
  }
}

// 监听来自popup的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('收到消息:', request);
  
  if (request.action === 'startCollect') {
    console.log('开始采集，当前状态:', {
      isCollecting,
      collectedGamesCount: collectedGames.length,
      progress: currentProgress
    });
    maxConcurrentTabs = Math.min(Math.max(request.concurrentTabs || 5, 1), 20);
    startCollecting();
    sendResponse({ success: true });
  } else if (request.action === 'stopCollect') {
    console.log('停止采集');
    stopCollecting();
    sendResponse({ success: true });
  } else if (request.action === 'restart') {
    console.log('重新开始');
    resetAll().then(() => {
      sendResponse({ success: true });
    });
    return true; // 保持消息通道开放，等待异步操作完成
  } else if (request.action === 'getProgress') {
    // 计算耗时
    let duration = null;
    if (startTime) {
      const end = endTime || new Date();
      duration = end - startTime;
    }
    
    console.log('获取进度:', {
      isCollecting,
      progress: currentProgress,
      collectedGamesCount: collectedGames.length,
      duration
    });
    
    sendResponse({ 
      isCollecting,
      progress: currentProgress,
      collectedGames,
      startTime,
      endTime,
      duration
    });
  }
  return true;
});

// 监听标签页更新
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (!isCollecting) return;

  if (activeTabs.has(tabId) && changeInfo.status === 'complete') {
    console.log('标签页更新:', {
      tabId,
      url: tab.url,
      isAllGames: tab.url.includes('/All-Games'),
      isGamePage: tab.url.includes('/Game/')
    });
    
    try {
      // 等待页面完全加载
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // 如果是All-Games页面，获取游戏链接
      if (tab.url.includes('/All-Games')) {
        console.log('处理All-Games页面');
        const result = await chrome.scripting.executeScript({
          target: { tabId: tabId },
          function: () => {
            const links = Array.from(document.querySelectorAll('a[href*="/Game/"]'))
              .map(a => a.href)
              .filter(href => href.includes('/Game/') && !href.includes('/embed/'));
            return [...new Set(links)]; // 去重
          }
        });

        if (result[0].result) {
          gameLinks = result[0].result;
          currentProgress.total = gameLinks.length;
          console.log('获取到游戏链接:', {
            linkCount: gameLinks.length,
            firstLink: gameLinks[0]
          });
        }

        // 关闭All-Games页面
        await chrome.tabs.remove(tabId);
        activeTabs.delete(tabId);

        // 开始并行处理游戏
        await processNextGames();
      } 
      // 如果是游戏详情页，采集数据
      else if (tab.url.includes('/Game/')) {
        console.log('处理游戏详情页:', tab.url);
        
        // 增加延迟，确保页面完全加载
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        const result = await chrome.scripting.executeScript({
          target: { tabId: tabId },
          function: () => {
            try {
              // 获取游戏名称
              const nameElement = document.querySelector('h1.game-title, h1');
              const name = nameElement?.textContent?.trim() || '';
              console.log('游戏名称:', name);
              
              // 获取嵌入链接
              const embedElement = document.querySelector('textarea.aff-iliate-link, textarea[class*="affiliate"]');
              const embedUrl = embedElement?.value || '';
              console.log('嵌入链接长度:', embedUrl.length);
              
              // 获取分类
              const categoryElements = document.querySelectorAll('.game-categories a, .categories a');
              const categories = Array.from(categoryElements)
                .map(a => a.textContent.trim())
                .filter(text => text && text !== 'All Games');
              console.log('分类:', categories);
              
              // 获取图标
              let icons = {
                large: '',
                medium: '',
                small: ''
              };
              
              // 尝试从不同位置获取图标
              const allImages = document.querySelectorAll('img');
              for (const img of allImages) {
                const src = img.src || '';
                const parent = img.closest('figure');
                const caption = parent?.querySelector('figcaption')?.textContent || '';
                
                if (src) {
                  if (caption.includes('180x180') || caption.includes('large')) {
                    icons.large = src;
                  } else if (caption.includes('120x120') || caption.includes('medium')) {
                    icons.medium = src;
                  } else if (caption.includes('60x60') || caption.includes('small')) {
                    icons.small = src;
                  }
                }
              }
              
              // 如果还没找到图标，尝试从其他来源获取
              if (!icons.large && !icons.medium && !icons.small) {
                const gameIcon = document.querySelector('.game-icon img, .icon img');
                if (gameIcon?.src) {
                  icons.large = gameIcon.src;
                  icons.medium = gameIcon.src;
                  icons.small = gameIcon.src;
                }
              }
              
              console.log('找到的图标:', icons);
              
              // 验证数据
              if (!name) {
                throw new Error('未找到游戏名称');
              }
              if (categories.length === 0) {
                throw new Error('未找到分类信息');
              }
              if (!icons.large && !icons.medium && !icons.small) {
                throw new Error('未找到任何图标');
              }
              
              return {
                name,
                url: window.location.href,
                embedUrl,
                categories,
                icons
              };
            } catch (error) {
              console.error('数据采集出错:', error.message);
              return null;
            }
          }
        });

        console.log('采集结果:', result);

        if (result[0]?.result) {
          collectedGames.push(result[0].result);
          await saveData(); // 等待数据保存完成
          console.log('采集到游戏数据:', {
            name: result[0].result.name,
            categories: result[0].result.categories,
            hasIcons: Object.values(result[0].result.icons).some(url => url !== ''),
            totalCollected: collectedGames.length
          });
        } else {
          console.warn('未能从页面获取有效数据，详细信息:', {
            hasResult: !!result[0],
            resultData: result[0]?.result,
            error: result[0]?.error,
            url: tab.url
          });
        }

        currentProgress.current++;
        console.log('更新进度:', currentProgress);
        
        // 关闭当前标签页
        await chrome.tabs.remove(tabId);
        activeTabs.delete(tabId);

        // 继续处理下一个游戏
        await processNextGames();
      }
    } catch (error) {
      console.error('采集数据时出错：', error);
      // 出错时也关闭标签页并继续下一个
      await chrome.tabs.remove(tabId);
      activeTabs.delete(tabId);
      await processNextGames();
    }
  }
});

// 并行处理多个游戏
async function processNextGames() {
  if (!isCollecting || currentProgress.current >= currentProgress.total) {
    console.log('采集任务结束，清理所有标签页');
    isCollecting = false;
    // 确保关闭所有活动标签页
    for (const tabId of activeTabs) {
      try {
        await chrome.tabs.remove(tabId);
      } catch (error) {
        console.error('关闭标签页出错:', error);
      }
    }
    activeTabs.clear();
    return;
  }

  // 计算需要打开的新标签页数量
  const remainingGames = currentProgress.total - currentProgress.current;
  const availableSlots = maxConcurrentTabs - activeTabs.size;
  const tabsToOpen = Math.min(remainingGames, availableSlots);

  console.log('处理下一批游戏:', {
    remainingGames,
    availableSlots,
    tabsToOpen,
    activeTabs: Array.from(activeTabs)
  });

  // 打开新的标签页
  for (let i = 0; i < tabsToOpen; i++) {
    const nextLink = gameLinks[currentProgress.current + i];
    if (nextLink) {
      try {
        const tab = await chrome.tabs.create({
          url: nextLink,
          active: false
        });
        activeTabs.add(tab.id);
      } catch (error) {
        console.error('打开标签页时出错：', error);
        currentProgress.current++;
      }
    }
  }
}

// 添加一个清理函数
async function cleanupTabs() {
  console.log('清理所有标签页');
  const promises = Array.from(activeTabs).map(async (tabId) => {
    try {
      await chrome.tabs.remove(tabId);
    } catch (error) {
      console.error('清理标签页出错:', error);
    }
  });
  await Promise.all(promises);
  activeTabs.clear();
}

// 修改停止采集函数
async function stopCollecting() {
  console.log('停止采集');
  isCollecting = false;
  endTime = new Date(); // 记录结束时间
  await cleanupTabs();
}

// 监听标签页关闭事件
chrome.tabs.onRemoved.addListener((tabId) => {
  if (activeTabs.has(tabId)) {
    console.log('标签页被关闭:', tabId);
    activeTabs.delete(tabId);
  }
});

// 修改 startCollecting 函数
async function startCollecting() {
  if (isCollecting) return;
  
  console.log('开始采集');
  startTime = new Date(); // 记录开始时间
  endTime = null; // 重置结束时间
  
  // 确保清理之前可能残留的标签页
  await cleanupTabs();
  
  isCollecting = true;
  // 只有当没有已采集的数据时才重置
  if (collectedGames.length === 0) {
    currentProgress = { total: 0, current: 0 };
    gameLinks = [];
  }

  try {
    // 打开All-Games页面
    const tab = await chrome.tabs.create({
      url: 'https://html5games.com/All-Games',
      active: false
    });
    activeTabs.add(tab.id);
  } catch (error) {
    console.error('打开All-Games页面时出错：', error);
    isCollecting = false;
    await cleanupTabs();
  }
} 