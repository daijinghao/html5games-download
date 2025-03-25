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
  const downloadBtn = document.getElementById('downloadBtn');
  const restartBtn = document.getElementById('restartBtn');
  const statusDiv = document.getElementById('status');
  const concurrentInput = document.getElementById('concurrentInput');

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
      downloadBtn.disabled = true;
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

  // 下载按钮点击事件
  downloadBtn.addEventListener('click', async () => {
    try {
      statusDiv.textContent = '正在准备下载...';
      downloadBtn.disabled = true;
      
      const response = await chrome.runtime.sendMessage({ action: 'getProgress' });
      console.log('获取到的数据:', response);

      if (!response) {
        throw new Error('未能获取数据');
      }
      if (!response.collectedGames) {
        throw new Error('数据格式错误：没有 collectedGames');
      }
      if (response.collectedGames.length === 0) {
        if (response.isCollecting) {
          throw new Error('正在采集中，暂无游戏数据，请等待采集完成');
        } else if (response.progress.current > 0) {
          throw new Error('采集已完成但未获取到有效数据，请重试');
        } else {
          throw new Error('没有已采集的游戏数据，请先开始采集');
        }
      }

      const durationText = response.duration ? `\n总耗时: ${formatDuration(response.duration)}` : '';
      const metadata = {
        totalGames: response.collectedGames.length,
        collectionDate: new Date().toISOString(),
        duration: response.duration,
        durationFormatted: formatDuration(response.duration)
      };

      // 将元数据和游戏数据一起保存
      const dataToSave = {
        metadata,
        games: response.collectedGames
      };

      statusDiv.textContent = '正在创建ZIP文件...';
      
      // 创建ZIP文件
      const zip = new JSZip();
      
      // 添加JSON数据
      zip.file('games.json', JSON.stringify(dataToSave, null, 2));
      console.log('已添加JSON数据');
      
      // 创建icons文件夹
      const iconsFolder = zip.folder('icons');
      
      // 下载所有图标
      for (const game of response.collectedGames) {
        if (!game.name) continue;
        
        const gameFolderName = game.name.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '_');
        console.log('处理游戏:', gameFolderName);
        const gameFolder = iconsFolder.folder(gameFolderName);
        
        try {
          // 下载大图标
          if (game.icons.large) {
            console.log('下载大图标:', game.icons.large);
            const largeResponse = await fetch(game.icons.large);
            if (largeResponse.ok) {
              const largeBlob = await largeResponse.blob();
              gameFolder.file('large.jpg', largeBlob);
            }
          }
          
          // 下载中图标
          if (game.icons.medium) {
            console.log('下载中图标:', game.icons.medium);
            const mediumResponse = await fetch(game.icons.medium);
            if (mediumResponse.ok) {
              const mediumBlob = await mediumResponse.blob();
              gameFolder.file('medium.jpg', mediumBlob);
            }
          }
          
          // 下载小图标
          if (game.icons.small) {
            console.log('下载小图标:', game.icons.small);
            const smallResponse = await fetch(game.icons.small);
            if (smallResponse.ok) {
              const smallBlob = await smallResponse.blob();
              gameFolder.file('small.jpg', smallBlob);
            }
          }
          
          statusDiv.textContent = `正在下载图标: ${gameFolderName}`;
        } catch (error) {
          console.error(`下载 ${gameFolderName} 的图标时出错:`, error);
        }
      }
      
      // 生成ZIP文件
      console.log('生成ZIP文件');
      statusDiv.textContent = '正在生成ZIP文件...';
      const content = await zip.generateAsync({
        type: 'blob',
        compression: 'DEFLATE',
        compressionOptions: {
          level: 9
        }
      });
      
      // 下载ZIP文件
      console.log('开始下载ZIP文件');
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      await chrome.downloads.download({
        url: URL.createObjectURL(content),
        filename: `html5games_data_${timestamp}.zip`,
        saveAs: true
      });
      
      statusDiv.textContent = `已采集: ${response.collectedGames.length} 个游戏${durationText}`;
    } catch (error) {
      console.error('下载过程出错:', error);
      statusDiv.textContent = error.message;
    } finally {
      downloadBtn.disabled = false;
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
        downloadBtn.disabled = true;
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
      downloadBtn.disabled = true;
      concurrentInput.disabled = true;
      statusDiv.textContent = `正在采集: ${response.progress.current}/${response.progress.total}${durationText}`;
    } else if (response.progress.current > 0) {
      collectBtn.disabled = false;
      stopBtn.disabled = true;
      downloadBtn.disabled = false;
      concurrentInput.disabled = false;
      statusDiv.textContent = `采集完成: ${response.progress.current} 个游戏${durationText}`;
    } else {
      collectBtn.disabled = false;
      stopBtn.disabled = true;
      downloadBtn.disabled = response.collectedGames?.length === 0;
      concurrentInput.disabled = false;
      if (response.collectedGames?.length > 0) {
        statusDiv.textContent = `已采集: ${response.collectedGames.length} 个游戏${durationText}`;
      } else {
        statusDiv.textContent = '准备就绪，请点击采集按钮开始';
      }
    }
  }
}); 