// 存储采集到的数据
let collectedData = {
  games: []
};

// 获取所有游戏链接
async function getAllGameLinks() {
  const links = Array.from(document.querySelectorAll('a[href*="/Game/"]'))
    .map(a => a.href)
    .filter(href => href.includes('/Game/') && !href.includes('/embed/'));
  return [...new Set(links)]; // 去重
}

// 采集游戏数据的主函数
function collectGameData() {
  try {
    // 获取当前页面信息
    const gameData = {
      name: document.querySelector('h1')?.textContent?.trim() || '',
      url: window.location.href,
      embedUrl: document.querySelector('input[type="text"]')?.value || '',
      categories: Array.from(document.querySelectorAll('.categories a')).map(a => a.textContent.trim()),
      icons: {
        large: document.querySelector('img[src*="180x180"]')?.src || '',
        medium: document.querySelector('img[src*="120x120"]')?.src || '',
        small: document.querySelector('img[src*="60x60"]')?.src || ''
      }
    };

    // 添加到采集数据中
    collectedData.games.push(gameData);
    return true;
  } catch (error) {
    console.error('采集数据时出错：', error);
    return false;
  }
}

// 获取采集到的数据
function getCollectedData() {
  return collectedData;
}

// 监听来自popup的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'collect') {
    const result = collectGameData();
    sendResponse({success: result});
  } else if (request.action === 'getData') {
    sendResponse(collectedData);
  } else if (request.action === 'getGameLinks') {
    const links = getAllGameLinks();
    sendResponse({links});
  }
  return true;
}); 