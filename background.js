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
              
              // 获取游戏描述 - 从 itemprop="description" 的 p 标签
              const descriptionMatch = document.querySelector('p[itemprop="description"]');
              let description = descriptionMatch?.textContent?.trim() || '';
              console.log('游戏描述:', description);
              
              // 如果没有找到描述，使用默认值
              if (!description) {
                description = 'No description';
                console.log('使用默认描述');
              }
              
              // 获取嵌入链接 - 从 textarea.aff-iliate-link 获取
              const embedMatch = document.querySelector('textarea.aff-iliate-link, textarea[class*="affiliate"]');
              const embedUrl = embedMatch?.value || '';
              console.log('嵌入链接长度:', embedUrl.length);
              
              // 获取分类 - 从 game-categories div 内的 ul > li > a 获取
              const categories = new Set(); // 使用 Set 来自动去重
              
              // 匹配 game-categories div 内的内容
              const categorySection = html.match(/<div[^>]*class="[^"]*game-categories[^"]*"[^>]*>[\s\S]*?<ul>([\s\S]*?)<\/ul>/i);
              if (categorySection) {
                // 从 ul 中提取所有 li > a 的文本
                const liPattern = /<li><a[^>]*>(?:<i[^>]*><\/i>\s*)?([^<]+)<\/a><\/li>/g;
                let match;
                while ((match = liPattern.exec(categorySection[1])) !== null) {
                  // 处理分类文本：去除 &nbsp; 和多余空格
                  const category = match[1]
                    .replace(/&nbsp;/g, '') // 移除 &nbsp;
                    .trim();
                  
                  if (category && category !== 'All Games') {
                    categories.add(category);
                  }
                }
              }
              
              const categoryArray = Array.from(categories);
              console.log('游戏分类:', categoryArray);
              
              // 如果没有找到任何分类，使用默认分类
              if (categoryArray.length === 0) {
                categoryArray.push('Games');
                console.log('使用默认分类:', categoryArray);
              }
              
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
              if (categoryArray.length === 0) {
                throw new Error('未找到分类信息');
              }
              if (!icons.large && !icons.medium && !icons.small) {
                throw new Error('未找到任何图标');
              }
              
              return {
                name,
                url: window.location.href,
                embedUrl,
                categories: categoryArray,
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

// 获取游戏数据
async function getGameData(url) {
  try {
    console.log('获取游戏数据:', url);
    const response = await fetch(url);
    const html = await response.text();
    
    // 获取游戏名称 - 从 header 标签内的 h1
    const nameMatch = html.match(/<h1[^>]*itemprop="name"[^>]*>([^<]+)<\/h1>/);
    const name = nameMatch ? nameMatch[1].trim() : '';
    console.log('游戏名称:', name);
    
    // 获取游戏描述 - 从 itemprop="description" 的 p 标签
    const descriptionMatch = html.match(/<p[^>]*itemprop="description"[^>]*>([^<]+)<\/p>/);
    let description = descriptionMatch ? descriptionMatch[1].trim() : '';
    console.log('游戏描述:', description);
    
    // 如果没有找到描述，使用默认值
    if (!description) {
      description = 'No description';
      console.log('使用默认描述');
    }
    
    // 获取嵌入链接 - 从 textarea.aff-iliate-link 获取
    const embedMatch = html.match(/<textarea[^>]*class="[^"]*aff-iliate-link[^"]*"[^>]*>([^<]+)<\/textarea>/i);
    const embedUrl = embedMatch ? embedMatch[1].trim() : '';
    console.log('嵌入链接:', embedUrl);
    
    // 获取分类 - 从 game-categories div 内的 ul > li > a 获取
    const categories = new Set(); // 使用 Set 来自动去重
    
    // 匹配 game-categories div 内的内容
    const categorySection = html.match(/<div[^>]*class="[^"]*game-categories[^"]*"[^>]*>[\s\S]*?<ul>([\s\S]*?)<\/ul>/i);
    if (categorySection) {
      // 从 ul 中提取所有 li > a 的文本
      const liPattern = /<li><a[^>]*>(?:<i[^>]*><\/i>\s*)?([^<]+)<\/a><\/li>/g;
      let match;
      while ((match = liPattern.exec(categorySection[1])) !== null) {
        // 处理分类文本：去除 &nbsp; 和多余空格
        const category = match[1]
          .replace(/&nbsp;/g, '') // 移除 &nbsp;
          .trim();
        
        if (category && category !== 'All Games') {
          categories.add(category);
        }
      }
    }
    
    const categoryArray = Array.from(categories);
    console.log('游戏分类:', categoryArray);
    
    // 如果没有找到任何分类，使用默认分类
    if (categoryArray.length === 0) {
      categoryArray.push('Games');
      console.log('使用默认分类:', categoryArray);
    }
    
    // 获取图标
    let icons = {
      large: '',
      medium: '',
      small: ''
    };
    
    // 匹配所有图片标签及其父元素的 figcaption
    const imgPattern = /<figure[^>]*>.*?<img[^>]*src="([^"]+)".*?<figcaption[^>]*>([^<]+)<\/figcaption>.*?<\/figure>/gs;
    let imgMatch;
    while ((imgMatch = imgPattern.exec(html)) !== null) {
      const [, src, caption] = imgMatch;
      if (caption.includes('180x180')) {
        icons.large = src;
      } else if (caption.includes('120x120')) {
        icons.medium = src;
      } else if (caption.includes('60x60')) {
        icons.small = src;
      }
    }
    
    // 如果没有找到带 caption 的图标，尝试从其他位置获取
    if (!icons.large && !icons.medium && !icons.small) {
      const iconMatch = html.match(/<img[^>]*class="[^"]*(?:game-icon|icon)[^"]*"[^>]*src="([^"]+)"/i);
      if (iconMatch) {
        icons.large = iconMatch[1];
        icons.medium = iconMatch[1];
        icons.small = iconMatch[1];
      }
    }
    
    // 验证数据
    if (!name) {
      throw new Error('未找到游戏名称');
    }
    if (!description) {
      description = 'No description';
      console.error('未找到游戏描述');
    }
    if (categoryArray.length === 0) {
      // 如果实在找不到分类，使用默认分类
      categoryArray.push('Games');
      console.log('使用默认分类:', categoryArray);
    }
    if (!icons.large && !icons.medium && !icons.small) {
      throw new Error('未找到任何图标');
    }
    if (!embedUrl) {
      throw new Error('未找到嵌入链接');
    }
    
    return {
      name,
      url,
      embedUrl,
      description,
      categories: categoryArray,
      icons
    };
  } catch (error) {
    console.error('获取游戏数据出错:', error);
    return null;
  }
}

// 处理游戏列表页面
async function processAllGamesPage(url) {
  try {
    console.log('处理游戏列表页面:', url);
    const response = await fetch(url);
    const html = await response.text();
    
    console.log('获取到HTML内容长度:', html.length);
    
    // 首先匹配广告div内的内容
    const divPattern = /<div[^>]*id="div-gpt-ad-content"[^>]*>.*?<ul[^>]*class="games"[^>]*>(.*?)<\/ul>/s;
    const divMatch = divPattern.exec(html);
    
    if (!divMatch) {
      console.error('未找到游戏列表容器');
      console.log('页面内容示例:', html.substring(0, 1000));
      throw new Error('未找到游戏列表容器');
    }
    
    const gamesHtml = divMatch[1];
    const links = new Set();
    
    // 匹配游戏链接
    const linkPattern = /<a[^>]*href="([^"]*\/Game\/[^"]+)"[^>]*>/g;
    let match;
    
    while ((match = linkPattern.exec(gamesHtml)) !== null) {
      let link = match[1];
      // 如果是相对路径，转换为完整URL
      if (link.startsWith('/')) {
        link = 'https://html5games.com' + link;
      } else if (!link.startsWith('http')) {
        link = 'https://html5games.com/' + link;
      }
      
      // 过滤掉嵌入链接
      if (!link.includes('/embed/')) {
        links.add(link);
      }
    }
    
    const uniqueLinks = Array.from(links);
    console.log('找到游戏链接数量:', uniqueLinks.length);
    
    if (uniqueLinks.length === 0) {
      console.log('游戏列表HTML:', gamesHtml);
      throw new Error('未找到任何游戏链接，请检查页面内容和正则表达式');
    }
    
    return uniqueLinks;
  } catch (error) {
    console.error('处理游戏列表页面出错:', error);
    throw error;
  }
}

// 并行处理多个游戏
async function processGamesInBatch(gameLinks, startIndex, batchSize) {
  const endIndex = Math.min(startIndex + batchSize, gameLinks.length);
  const batch = gameLinks.slice(startIndex, endIndex);
  
  console.log(`处理游戏批次 ${startIndex + 1} 到 ${endIndex}`);
  const promises = batch.map(url => getGameData(url));
  
  try {
    const results = await Promise.all(promises);
    const validResults = results.filter(result => result !== null);
    
    if (validResults.length > 0) {
      collectedGames.push(...validResults);
      await saveData();
    }
    
    currentProgress.current = startIndex + batch.length;
    
    // 如果还有更多游戏要处理
    if (endIndex < gameLinks.length && isCollecting) {
      // 添加小延迟避免请求过于频繁
      await new Promise(resolve => setTimeout(resolve, 1000));
      await processGamesInBatch(gameLinks, endIndex, batchSize);
    } else {
      // 采集完成
      isCollecting = false;
      endTime = new Date();
    }
  } catch (error) {
    console.error('处理游戏批次出错:', error);
  }
}

// 开始采集
async function startCollecting() {
  if (isCollecting) return;
  
  console.log('开始采集');
  startTime = new Date();
  endTime = null;
  
  isCollecting = true;
  if (collectedGames.length === 0) {
    currentProgress = { total: 0, current: 0 };
  }
  
  try {
    // 获取所有游戏链接
    const links = await processAllGamesPage('https://html5games.com/All-Games');
    if (links.length === 0) {
      throw new Error('未找到游戏链接');
    }
    
    currentProgress.total = links.length;
    // 开始批量处理游戏
    await processGamesInBatch(links, currentProgress.current, maxConcurrentTabs);
  } catch (error) {
    console.error('采集过程出错:', error);
    isCollecting = false;
    endTime = new Date();
  }
} 