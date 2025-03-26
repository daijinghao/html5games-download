// 格式化时间
function formatDuration(ms) {
  if (!ms) return '';
  
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  
  const remainingMinutes = minutes % 60;
  const remainingSeconds = seconds % 60;
  
  let parts = [];
  if (hours > 0) {
    parts.push(`${hours}小时`);
  }
  if (remainingMinutes > 0 || hours > 0) {
    parts.push(`${remainingMinutes}分钟`);
  }
  parts.push(`${remainingSeconds}秒`);
  
  return parts.join('');
}

document.addEventListener('DOMContentLoaded', function() {
  const collectBtn = document.getElementById('collectBtn');
  const stopBtn = document.getElementById('stopBtn');
  const downloadJsonBtn = document.getElementById('downloadJsonBtn');
  const downloadFullBtn = document.getElementById('downloadFullBtn');
  const restartBtn = document.getElementById('restartBtn');
  const statusDiv = document.getElementById('status');
  const concurrentInput = document.getElementById('concurrentInput');
  const progressContainer = document.getElementById('progressContainer');
  const progressFill = document.getElementById('progressFill');
  const progressText = document.getElementById('progressText');

  // 限制并发数输入范围
  concurrentInput.addEventListener('change', () => {
    let value = parseInt(concurrentInput.value);
    if (value < 1) concurrentInput.value = 1;
    if (value > 20) concurrentInput.value = 20;
  });

  // 初始化时获取当前状态
  console.log('正在初始化插件...');
  chrome.runtime.sendMessage({ action: 'getProgress' }, (response) => {
    console.log('初始化状态:', {
      response,
      hasCollectedGames: response?.collectedGames?.length > 0,
      isCollecting: response?.isCollecting
    });
    if (response) {
      updateUI(response);
    }
  });

  // 采集按钮点击事件
  collectBtn.addEventListener('click', async () => {
    try {
      console.log('开始采集按钮被点击');
      collectBtn.disabled = true;
      stopBtn.disabled = false;
      downloadJsonBtn.disabled = true;
      downloadFullBtn.disabled = true;
      statusDiv.textContent = '正在采集游戏数据...';
      
      const concurrentTabs = parseInt(concurrentInput.value);
      console.log('设置的并发数:', concurrentTabs);
      
      // 开始采集，传递并发数
      const response = await chrome.runtime.sendMessage({
        action: 'startCollect',
        concurrentTabs: concurrentTabs
      });
      
      console.log('采集开始响应:', response);
    } catch (error) {
      console.error('采集出错：', error);
      statusDiv.textContent = '采集出错：' + error.message;
      collectBtn.disabled = false;
      stopBtn.disabled = true;
    }
  });

  // 停止按钮点击事件
  stopBtn.addEventListener('click', async () => {
    await chrome.runtime.sendMessage({
      action: 'stopCollect'
    });
    collectBtn.disabled = false;
    stopBtn.disabled = true;
    statusDiv.textContent = '采集已停止';
  });

  // 更新进度条
  function updateProgress(percent, text) {
    progressContainer.style.display = 'block';
    progressFill.style.width = `${percent}%`;
    progressText.textContent = text;
  }

  // 隐藏进度条
  function hideProgress() {
    progressContainer.style.display = 'none';
    progressFill.style.width = '0%';
    progressText.textContent = '准备下载...';
  }

  // 下载 JSON 数据
  downloadJsonBtn.addEventListener('click', async () => {
    try {
      statusDiv.textContent = '正在准备下载 JSON 数据...';
      downloadJsonBtn.disabled = true;
      downloadFullBtn.disabled = true;
      
      const response = await chrome.runtime.sendMessage({ action: 'getProgress' });
      console.log('获取到的数据:', response);

      if (!response || !response.collectedGames || response.collectedGames.length === 0) {
        throw new Error('没有可下载的游戏数据');
      }

      const metadata = {
        totalGames: response.collectedGames.length,
        collectionDate: new Date().toISOString(),
        duration: response.duration,
        durationFormatted: formatDuration(response.duration)
      };

      const dataToSave = {
        metadata,
        games: response.collectedGames
      };

      const blob = new Blob([JSON.stringify(dataToSave, null, 2)], { type: 'application/json' });
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      
      await chrome.downloads.download({
        url: URL.createObjectURL(blob),
        filename: `html5games_data_${timestamp}.json`,
        saveAs: true
      });

      statusDiv.textContent = 'JSON 数据下载完成！';
    } catch (error) {
      console.error('下载出错：', error);
      statusDiv.textContent = '下载出错：' + error.message;
    } finally {
      downloadJsonBtn.disabled = false;
      downloadFullBtn.disabled = false;
      hideProgress();
    }
  });

  // 下载完整数据包
  downloadFullBtn.addEventListener('click', async () => {
    try {
      statusDiv.textContent = '正在准备下载完整数据包...';
      downloadJsonBtn.disabled = true;
      downloadFullBtn.disabled = true;
      
      const response = await chrome.runtime.sendMessage({ action: 'getProgress' });
      if (!response || !response.collectedGames || response.collectedGames.length === 0) {
        throw new Error('没有可下载的游戏数据');
      }

      const metadata = {
        totalGames: response.collectedGames.length,
        collectionDate: new Date().toISOString(),
        duration: response.duration,
        durationFormatted: formatDuration(response.duration)
      };

      const dataToSave = {
        metadata,
        games: response.collectedGames
      };

      updateProgress(0, '正在创建 ZIP 文件...');
      const zip = new JSZip();
      zip.file('games.json', JSON.stringify(dataToSave, null, 2));
      
      const iconsFolder = zip.folder('icons');
      const totalIcons = response.collectedGames.length * 3; // 每个游戏3个图标
      let processedIcons = 0;
      
      for (const game of response.collectedGames) {
        if (!game.name) continue;
        
        const gameFolderName = game.name.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '_');
        const gameFolder = iconsFolder.folder(gameFolderName);
        
        try {
          // 下载大图标
          if (game.icons.large) {
            const largeResponse = await fetch(game.icons.large);
            if (largeResponse.ok) {
              const largeBlob = await largeResponse.blob();
              gameFolder.file('large.jpg', largeBlob);
            }
            processedIcons++;
            updateProgress(
              (processedIcons / totalIcons) * 100,
              `正在下载图标: ${gameFolderName} (${processedIcons}/${totalIcons})`
            );
          }
          
          // 下载中图标
          if (game.icons.medium) {
            const mediumResponse = await fetch(game.icons.medium);
            if (mediumResponse.ok) {
              const mediumBlob = await mediumResponse.blob();
              gameFolder.file('medium.jpg', mediumBlob);
            }
            processedIcons++;
            updateProgress(
              (processedIcons / totalIcons) * 100,
              `正在下载图标: ${gameFolderName} (${processedIcons}/${totalIcons})`
            );
          }
          
          // 下载小图标
          if (game.icons.small) {
            const smallResponse = await fetch(game.icons.small);
            if (smallResponse.ok) {
              const smallBlob = await smallResponse.blob();
              gameFolder.file('small.jpg', smallBlob);
            }
            processedIcons++;
            updateProgress(
              (processedIcons / totalIcons) * 100,
              `正在下载图标: ${gameFolderName} (${processedIcons}/${totalIcons})`
            );
          }
        } catch (error) {
          console.error(`下载 ${gameFolderName} 的图标时出错:`, error);
        }
      }
      
      updateProgress(100, '正在生成 ZIP 文件...');
      const content = await zip.generateAsync({
        type: 'blob',
        compression: 'DEFLATE',
        compressionOptions: {
          level: 9
        }
      });
      
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      await chrome.downloads.download({
        url: URL.createObjectURL(content),
        filename: `html5games_full_${timestamp}.zip`,
        saveAs: true
      });

      statusDiv.textContent = '完整数据包下载完成！';
    } catch (error) {
      console.error('下载出错：', error);
      statusDiv.textContent = '下载出错：' + error.message;
    } finally {
      downloadJsonBtn.disabled = false;
      downloadFullBtn.disabled = false;
      hideProgress();
    }
  });

  // 重新开始按钮点击事件
  restartBtn.addEventListener('click', async () => {
    try {
      if (confirm('确定要重新开始吗？这将清除所有已采集的数据。')) {
        statusDiv.textContent = '正在重置...';
        await chrome.runtime.sendMessage({ action: 'restart' });
        
        // 重置UI状态
        collectBtn.disabled = false;
        stopBtn.disabled = true;
        downloadJsonBtn.disabled = true;
        downloadFullBtn.disabled = true;
        concurrentInput.disabled = false;
        statusDiv.textContent = '准备就绪，请点击采集按钮开始';
        
        console.log('已重置所有数据');
      }
    } catch (error) {
      console.error('重置过程出错:', error);
      statusDiv.textContent = '重置出错：' + error.message;
    }
  });

  // 定期检查采集进度
  setInterval(async () => {
    try {
      const response = await chrome.runtime.sendMessage({ action: 'getProgress' });
      console.log('进度更新:', response);
      if (response) {
        updateUI(response);
      }
    } catch (error) {
      console.error('检查进度时出错:', error);
    }
  }, 1000);

  // 更新UI状态
  function updateUI(response) {
    console.log('更新UI状态:', {
      isCollecting: response.isCollecting,
      progress: response.progress,
      gamesCount: response.collectedGames?.length || 0,
      duration: response.duration
    });
    
    const durationText = response.duration ? ` (耗时: ${formatDuration(response.duration)})` : '';
    
    if (response.isCollecting) {
      collectBtn.disabled = true;
      stopBtn.disabled = false;
      downloadJsonBtn.disabled = true;
      downloadFullBtn.disabled = true;
      concurrentInput.disabled = true;
      statusDiv.textContent = `正在采集: ${response.progress.current}/${response.progress.total}${durationText}`;
    } else if (response.progress.current > 0) {
      collectBtn.disabled = false;
      stopBtn.disabled = true;
      downloadJsonBtn.disabled = false;
      downloadFullBtn.disabled = false;
      concurrentInput.disabled = false;
      statusDiv.textContent = `采集完成: ${response.progress.current} 个游戏${durationText}`;
    } else {
      collectBtn.disabled = false;
      stopBtn.disabled = true;
      downloadJsonBtn.disabled = response.collectedGames?.length === 0;
      downloadFullBtn.disabled = response.collectedGames?.length === 0;
      concurrentInput.disabled = false;
      if (response.collectedGames?.length > 0) {
        statusDiv.textContent = `已采集: ${response.collectedGames.length} 个游戏${durationText}`;
      } else {
        statusDiv.textContent = '准备就绪，请点击采集按钮开始';
      }
    }
  }
}); 