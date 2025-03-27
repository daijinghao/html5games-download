const JSZip = require('jszip');
const fetch = require('node-fetch');
const supabase = require('../db/supabase');
const fs = require('fs').promises;
const path = require('path');

// 缓存上次更新时间，避免频繁更新
let lastUpdateTime = 0;
const UPDATE_INTERVAL = 2000; // 2秒更新一次

// 更新游戏总数
async function updateTotalGames(count) {
    try {
        const now = Date.now();
        // 如果距离上次更新不足2秒，则跳过
        if (now - lastUpdateTime < UPDATE_INTERVAL) {
            return;
        }
        lastUpdateTime = now;

        // 只更新 total_games 字段
        const { error } = await supabase
            .from('game_data')
            .update({ total_games: count })
            .eq('id', 1);

        if (error) {
            console.error('更新游戏总数失败:', error);
        }
    } catch (error) {
        console.error('更新游戏总数时出错:', error);
    }
}

class GameCollector {
    constructor() {
        this.supabase = supabase;
        this.games = [];
        this.totalGames = 0;
        this.currentProgress = 0;
        this.isCollecting = false;
        this.currentProgress = {
            total: 0,
            current: 0,
            errors: [],
            stage: '准备中',
            stageProgress: 0
        };
        this.collectedGames = [];
        this.batchSize = 50;
        this.pendingGames = [];
        this.COLLECTION_INTERVAL = 60 * 60 * 1000;
    }

    // 检查采集状态是否异常（超过一定时间没有更新）
    async checkStaleCollectionStatus() {
        try {
            const { data, error } = await this.supabase
                .from('system_status')
                .select('is_collecting, last_collection_start')
                .eq('id', 1)
                .single();

            if (error) throw error;

            if (data.is_collecting && data.last_collection_start) {
                const lastStart = new Date(data.last_collection_start).getTime();
                const now = Date.now();
                const MAX_COLLECTION_TIME = 30 * 60 * 1000; // 30分钟

                // 如果采集时间超过30分钟，认为是异常状态
                if (now - lastStart > MAX_COLLECTION_TIME) {
                    console.log('检测到异常的采集状态，重置状态');
                    await this.updateSystemStatus(false);
                    return true;
                }
            }
            return false;
        } catch (error) {
            console.error('检查采集状态异常失败:', error);
            return false;
        }
    }

    async shouldCollectData() {
        try {
            // 先检查是否存在异常状态
            await this.checkStaleCollectionStatus();

            const { data, error } = await this.supabase
                .from('system_status')
                .select('is_collecting')
                .eq('id', 1)
                .single();

            if (error) throw error;

            // 只要当前没有采集任务在进行，就可以开始新的采集
            return !data.is_collecting;
        } catch (error) {
            console.error('检查采集状态失败:', error);
            throw error;
        }
    }

    async startCollecting() {
        try {
            // 检查是否有采集任务在进行
            const shouldCollect = await this.shouldCollectData();
            if (!shouldCollect) {
                console.log('已有采集任务在进行中');
                return false;
            }

            // 更新系统状态为采集中
            await this.updateSystemStatus(true);

            // 执行采集操作
            console.log('开始采集游戏链接...');
            const gameLinks = await this.collectGameLinks();
            console.log(`成功获取 ${gameLinks.length} 个游戏链接`);

            // 设置待采集的游戏链接
            this.pendingGames = gameLinks;
            
            // 采集游戏详情
            console.log('开始采集游戏详情...');
            const { games, errors } = await this.collectGameDetails();
            this.games = games;
            
            console.log(`游戏详情采集完成，成功: ${games.length}，失败: ${errors.length}`);

            // 生成完整数据包
            console.log('开始生成数据包...');
            this.updateStage('生成数据包', 0);

            // 从数据库获取所有游戏数据
            const { data: allGames, error: gamesError } = await this.supabase
                .from('games')
                .select('*')
                .eq('is_collected', true);

            if (gamesError) {
                throw new Error('获取游戏数据失败: ' + gamesError.message);
            }

            console.log(`从数据库获取到 ${allGames.length} 个游戏数据`);

            // 将 games 数组转换为格式化的 JSON 对象
            const jsonData = {
                total: allGames.length,
                updated_at: new Date().toISOString(),
                games: allGames
            };

            // 先处理 JSON 数据
            console.log('开始生成 JSON 数据...');
            const jsonString = JSON.stringify(jsonData, null, 2);
            console.log('JSON 数据生成完成，准备更新到数据库');

            // 立即更新 JSON 数据到数据库
            const { error: jsonError } = await this.supabase
                .from('game_data')
                .upsert({
                    id: 1,
                    total_games: allGames.length,
                    json_data: jsonData,
                    is_active: true,
                    package_path: null  // 重置 package_path，直到 ZIP 包生成完成
                })
                .eq('id', 1);

            if (jsonError) {
                throw new Error('更新 JSON 数据失败: ' + jsonError.message);
            }
            console.log('JSON 数据更新成功，现在可以下载');

            // 异步处理 ZIP 包，不阻塞主流程
            console.log('开始异步生成 ZIP 包...');
            this.createZipPackage(allGames)
                .then(async (zipBuffer) => {
                    console.log('ZIP 包生成完成，准备保存文件');
                    
                    // 保存 ZIP 文件
                    const packageDir = path.join(__dirname, '../../..', 'public', 'packages');
                    const packageFileName = `games_${new Date().toISOString().split('T')[0]}.zip`;
                    const packagePath = path.join(packageDir, packageFileName);

                    try {
                        await fs.mkdir(packageDir, { recursive: true });
                        await fs.writeFile(packagePath, zipBuffer);
                        console.log('ZIP 文件保存成功:', packagePath);

                        // 更新数据库中的包路径
                        const { error: updateError } = await this.supabase
                            .from('game_data')
                            .update({
                                package_path: `/packages/${packageFileName}`
                            })
                            .eq('id', 1);

                        if (updateError) {
                            console.error('更新包路径失败:', updateError);
                        } else {
                            console.log('ZIP 包路径更新成功，现在可以下载');
                        }
                    } catch (error) {
                        console.error('保存 ZIP 文件失败:', error);
                    }
                })
                .catch(error => {
                    console.error('生成 ZIP 包失败:', error);
                });

            // 主流程继续执行，不等待 ZIP 包处理完成
            console.log('数据采集流程完成');

            // 更新系统状态为完成
            await this.updateSystemStatus(false);
            console.log('采集任务完成');

            return true;
        } catch (error) {
            // 更新错误状态
            await this.updateSystemStatus(false, error.message);
            console.error('采集过程出错:', error);
            throw error;
        }
    }

    // 检查是否需要重新采集
    async shouldCollect() {
        try {
            const { data, error } = await supabase
                .from('system_status')
                .select('last_collection_end')
                .eq('id', 1)
                .single();

            if (error) {
                console.error('检查上次采集时间失败:', error);
                return true; // 如果出错，为安全起见返回 true
            }

            if (!data || !data.last_collection_end) {
                return true; // 如果没有记录，需要采集
            }

            const lastCollectionTime = new Date(data.last_collection_end).getTime();
            const now = Date.now();
            
            return (now - lastCollectionTime) > this.COLLECTION_INTERVAL;
        } catch (error) {
            console.error('检查采集状态失败:', error);
            return true; // 如果出错，为安全起见返回 true
        }
    }

    // 采集游戏链接
    async collectGameLinks() {
        try {
            this.currentProgress.stage = '采集游戏链接';
            this.currentProgress.stageProgress = 0;

            // 获取游戏列表页面
            const html = await this.fetchGameListPage();
            
            // 提取游戏链接
            const gameLinks = await this.extractGameLinks(html);
            
            // 更新进度
            this.currentProgress.stageProgress = 100;
            
            return gameLinks;
        } catch (error) {
            console.error('采集游戏链接失败:', error);
            throw error;
        }
    }

    // 采集游戏详情
    async collectGameDetails() {
        try {
            this.currentProgress.stage = '采集游戏详情';
            this.currentProgress.stageProgress = 0;

            // 使用并发采集
            const { games, errors } = await this.collectWithConcurrency(this.pendingGames, 5);
            
            // 更新进度
            this.currentProgress.stageProgress = 100;
            
            // 处理错误
            if (errors.length > 0) {
                console.error('部分游戏采集失败:', errors);
                this.currentProgress.errors.push(...errors);
            }
            
            return { games, errors };
        } catch (error) {
            console.error('采集游戏详情失败:', error);
            throw error;
        }
    }

    // 获取游戏列表页面
    async fetchGameListPage() {
        try {
            console.log('正在请求游戏列表页面...');
            const response = await fetch('https://html5games.com/All-Games', {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.5',
                    'Cache-Control': 'no-cache',
                    'Pragma': 'no-cache'
                }
            });
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            console.log('成功获取页面，正在解析内容...');
            const html = await response.text();
            return html;
        } catch (error) {
            console.error('获取游戏列表失败:', error);
            throw new Error('获取游戏列表失败: ' + error.message);
        }
    }

    // 从列表页面提取游戏链接
    async extractGameLinks(html) {
        console.log('开始解析游戏链接...');
        const links = new Set();
        
        // 首先匹配游戏列表容器
        const containerPatterns = [
            /<div[^>]*id="div-gpt-ad-content"[^>]*>.*?<ul[^>]*class="games"[^>]*>(.*?)<\/ul>/s,
            /<ul[^>]*class="games"[^>]*>(.*?)<\/ul>/s,
            /<div[^>]*class="[^"]*games-list[^"]*"[^>]*>(.*?)<\/div>/s
        ];
        
        let gamesHtml = null;
        for (const pattern of containerPatterns) {
            const match = pattern.exec(html);
            if (match) {
                gamesHtml = match[1];
                console.log('找到游戏列表容器');
                break;
            }
        }
        
        if (!gamesHtml) {
            console.error('未找到游戏列表容器，HTML内容:', html.substring(0, 500) + '...');
            throw new Error('未找到游戏列表容器');
        }
        
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
        
        const linkArray = Array.from(links);
        console.log(`共找到 ${linkArray.length} 个游戏链接`);
        
        if (linkArray.length === 0) {
            console.error('未找到任何游戏链接');
            throw new Error('未找到任何游戏链接');
        }

        // 更新总游戏数和进度信息
        this.currentProgress.total = linkArray.length;
        this.currentProgress.current = 0;
        this.totalGames = linkArray.length;

        // 立即更新游戏总数到数据库
        try {
            console.log('正在更新游戏总数到数据库...');
            // 先获取现有数据
            const { data: existingData, error: fetchError } = await this.supabase
                .from('game_data')
                .select('json_data')
                .eq('id', 1)
                .single();

            if (fetchError && fetchError.code !== 'PGRST116') {
                console.error('获取现有数据失败:', fetchError);
                return;
            }

            // 准备更新数据，只保留 json_data
            const updateData = {
                id: 1,
                total_games: linkArray.length,
                is_active: true,
                json_data: existingData?.json_data || { games: [] } // 如果没有现有数据，使用空数组
            };

            const { error } = await this.supabase
                .from('game_data')
                .upsert(updateData)
                .eq('id', 1);

            if (error) {
                console.error('更新游戏总数失败:', error);
            } else {
                console.log('游戏总数已更新:', linkArray.length);
            }
        } catch (error) {
            console.error('更新游戏总数时出错:', error);
        }
        
        return linkArray;
    }

    // 添加重试函数
    async retryFetch(url, options = {}, retries = 3, delay = 2000) {
        for (let i = 0; i < retries; i++) {
            try {
                const response = await fetch(url, options);
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                return response;
            } catch (error) {
                if (i === retries - 1) throw error; // 如果是最后一次重试，则抛出错误
                console.log(`第 ${i + 1} 次请求失败，${delay/1000}秒后重试...`, error.message);
                await new Promise(resolve => setTimeout(resolve, delay));
                // 每次重试增加延迟
                delay *= 1.5;
            }
        }
    }

    // 获取游戏详情
    async fetchGameDetails(url) {
        try {
            const response = await this.retryFetch(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.5',
                    'Cache-Control': 'no-cache',
                    'Pragma': 'no-cache'
                },
                timeout: 10000 // 10秒超时
            });
            
            const html = await response.text();
            
            // 获取游戏名称 - 从 header 标签内的 h1
            const nameMatch = html.match(/<h1[^>]*itemprop="name"[^>]*>([^<]+)<\/h1>/);
            const name = nameMatch ? nameMatch[1].trim() : '';
            
            // 获取游戏描述 - 从 itemprop="description" 的 p 标签
            const descriptionMatch = html.match(/<p[^>]*itemprop="description"[^>]*>([^<]+)<\/p>/);
            let description = descriptionMatch ? descriptionMatch[1].trim() : 'No description';
            
            // 获取嵌入链接 - 从 textarea.aff-iliate-link 获取
            const embedMatch = html.match(/<textarea[^>]*class="[^"]*aff-iliate-link[^"]*"[^>]*>([^<]+)<\/textarea>/i);
            const embedUrl = embedMatch ? embedMatch[1].trim() : '';
            
            // 获取分类 - 从 game-categories div 内的 ul > li > a 获取
            const categories = new Set();
            
            // 匹配 game-categories div 内的内容
            const categorySection = html.match(/<div[^>]*class="[^"]*game-categories[^"]*"[^>]*>[\s\S]*?<ul>([\s\S]*?)<\/ul>/i);
            if (categorySection) {
                const liPattern = /<li><a[^>]*>(?:<i[^>]*><\/i>\s*)?([^<]+)<\/a><\/li>/g;
                let match;
                while ((match = liPattern.exec(categorySection[1])) !== null) {
                    const category = match[1].replace(/&nbsp;/g, '').trim();
                    if (category && category !== 'All Games') {
                        categories.add(category);
                    }
                }
            }
            
            const categoryArray = Array.from(categories);
            if (categoryArray.length === 0) {
                categoryArray.push('Games');
            }

            // 获取图标URL
            const icons = {
                large: '',
                medium: '',
                small: ''
            };

            // 尝试从 figure 标签中获取不同尺寸的图标
            const figurePattern = /<figure[^>]*>.*?<img[^>]*src="([^"]+)"[^>]*>.*?<figcaption[^>]*>([^<]+)<\/figcaption>.*?<\/figure>/gs;
            let figureMatch;
            while ((figureMatch = figurePattern.exec(html)) !== null) {
                const [, src, caption] = figureMatch;
                if (caption.includes('180x180')) {
                    icons.large = src;
                } else if (caption.includes('120x120')) {
                    icons.medium = src;
                } else if (caption.includes('60x60')) {
                    icons.small = src;
                }
            }

            // 如果没有找到带尺寸的图标，尝试从其他位置获取
            if (!icons.large && !icons.medium && !icons.small) {
                // 尝试从 game-icon 类获取
                const gameIconMatch = html.match(/<img[^>]*class="[^"]*game-icon[^"]*"[^>]*src="([^"]+)"[^>]*>/i);
                if (gameIconMatch) {
                    icons.large = gameIconMatch[1];
                    icons.medium = gameIconMatch[1];
                    icons.small = gameIconMatch[1];
                } else {
                    // 尝试从 og:image 元标签获取
                    const ogImageMatch = html.match(/<meta[^>]*property="og:image"[^>]*content="([^"]+)"[^>]*>/i);
                    if (ogImageMatch) {
                        icons.large = ogImageMatch[1];
                        icons.medium = ogImageMatch[1];
                        icons.small = ogImageMatch[1];
                    } else {
                        // 尝试从任何带有 icon 类的图片获取
                        const iconClassMatch = html.match(/<img[^>]*class="[^"]*icon[^"]*"[^>]*src="([^"]+)"[^>]*>/i);
                        if (iconClassMatch) {
                            icons.large = iconClassMatch[1];
                            icons.medium = iconClassMatch[1];
                            icons.small = iconClassMatch[1];
                        }
                    }
                }
            }

            return {
                name,
                url,
                embed_url: embedUrl,
                description,
                category: categoryArray.join(', '),
                icons
            };
        } catch (error) {
            console.error(`获取游戏详情失败: ${url}`, error);
            throw error;
        }
    }

    // 更新阶段信息
    updateStage(stage, stageProgress = 0) {
        this.currentProgress.stage = stage;
        this.currentProgress.stageProgress = stageProgress;
    }

    // 并发采集游戏详情
    async collectWithConcurrency(urls, concurrentLimit) {
        const games = [];
        const errors = [];
        this.currentProgress.total = urls.length;
        this.currentProgress.current = 0;
        this.currentProgress.errors = [];
        this.updateStage('采集游戏数据', 0);

        // 将URLs分组
        const chunks = [];
        for (let i = 0; i < urls.length; i += concurrentLimit) {
            chunks.push(urls.slice(i, i + concurrentLimit));
        }

        // 按组并发处理
        for (const chunk of chunks) {
            const promises = chunk.map(url => this.fetchGameDetails(url)
                .then(game => {
                    if (game && game.name) { // 确保游戏数据有效
                        games.push(game);
                        this.currentProgress.current++;
                        this.currentProgress.stageProgress = (this.currentProgress.current / this.currentProgress.total) * 100;
                        
                        // 当累积足够多的游戏数据时，进行批量更新
                        if (games.length >= this.batchSize) {
                            const batchGames = games.splice(0, this.batchSize);
                            return this.batchUpdateGames(batchGames);
                        }
                    } else {
                        throw new Error('Invalid game data: missing required fields');
                    }
                })
                .catch(error => {
                    console.error(`采集游戏失败 ${url}:`, error);
                    errors.push({ url, error: error.message });
                    this.currentProgress.current++;
                    this.currentProgress.stageProgress = (this.currentProgress.current / this.currentProgress.total) * 100;
                })
            );

            await Promise.all(promises);
            
            // 更新进度
            if (this.currentProgress.current % 20 === 0) {
                await updateTotalGames(this.currentProgress.current);
            }
        }

        // 处理剩余的待更新游戏数据
        if (games.length > 0) {
            await this.batchUpdateGames(games);
        }

        return { games, errors };
    }

    // 创建ZIP包
    async createZipPackage(games) {
        console.log('开始创建数据包...');
        const startTime = Date.now();
        
        this.updateStage('创建数据包', 0);
        const zip = new JSZip();
        
        // 添加游戏数据JSON文件
        zip.file('games.json', JSON.stringify(games, null, 2));
        this.updateStage('创建数据包', 20);
        
        // 创建 games 文件夹
        const gamesFolder = zip.folder('games');
        const totalGames = games.length;
        let processedGames = 0;
        
        for (const game of games) {
            if (!game.name) continue;
            
            // 创建游戏专属文件夹，使用游戏名作为文件夹名
            const gameFolderName = game.name.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '_');
            const gameFolder = gamesFolder.folder(gameFolderName);
            
            try {
                // 下载所有可用的图标
                if (game.icons) {
                    if (game.icons.large) {
                        const largeResponse = await fetch(game.icons.large);
                        if (largeResponse.ok) {
                            const largeBlob = await largeResponse.buffer();
                            gameFolder.file('large.png', largeBlob);
                        }
                    }
                    
                    if (game.icons.medium) {
                        const mediumResponse = await fetch(game.icons.medium);
                        if (mediumResponse.ok) {
                            const mediumBlob = await mediumResponse.buffer();
                            gameFolder.file('medium.png', mediumBlob);
                        }
                    }
                    
                    if (game.icons.small) {
                        const smallResponse = await fetch(game.icons.small);
                        if (smallResponse.ok) {
                            const smallBlob = await smallResponse.buffer();
                            gameFolder.file('small.png', smallBlob);
                        }
                    }
                }
            } catch (error) {
                console.error(`下载 ${game.name} 的图标时出错:`, error);
            }
            
            processedGames++;
            // 更新打包进度（20-90%）
            this.updateStage('创建数据包', 20 + Math.floor((processedGames / totalGames) * 70));
        }

        this.updateStage('创建数据包', 90);
        console.log('开始压缩数据包...');
        
        // 使用最高压缩级别
        const result = await zip.generateAsync({ 
            type: 'nodebuffer',
            compression: 'DEFLATE',
            compressionOptions: {
                level: 9
            }
        });
        
        const endTime = Date.now();
        console.log(`数据包创建完成，耗时: ${(endTime - startTime) / 1000}秒`);
        
        return result;
    }

    // 获取当前进度
    getProgress() {
        return this.currentProgress;
    }

    // 检查是否正在采集
    isCollectingData() {
        return this.isCollecting;
    }

    async updateProgress(progress) {
        this.currentProgress = progress;
        // 发送进度更新事件
        if (this.progressCallback) {
            this.progressCallback(progress);
        }
    }

    onProgress(callback) {
        this.progressCallback = callback;
    }

    // 批量更新游戏数据
    async batchUpdateGames(games) {
        if (!games || games.length === 0) return;

        try {
            console.log(`准备批量更新 ${games.length} 个游戏数据...`);
            
            // 验证和过滤数据
            const validGames = games.filter(game => 
                game && 
                game.name && 
                game.url && 
                game.embed_url && 
                game.category
            );

            if (validGames.length === 0) {
                console.error('没有有效的游戏数据需要更新');
                return;
            }

            console.log(`开始更新 ${validGames.length} 个有效游戏数据...`);
            
            const { error } = await this.supabase
                .from('games')
                .upsert(
                    validGames.map(game => ({
                        name: game.name,
                        url: game.url,
                        embed_url: game.embed_url,
                        description: game.description || '',
                        category: game.category,
                        icons: game.icons || {},
                        is_collected: true
                    })),
                    { onConflict: 'url' }
                );

            if (error) {
                console.error('批量更新游戏数据失败:', error);
                throw error;
            } else {
                console.log(`成功更新 ${validGames.length} 个游戏数据`);
            }
        } catch (error) {
            console.error('批量更新出错:', error);
            throw error;
        }
    }

    // 更新系统状态
    async updateSystemStatus(isCollecting, error = null) {
        try {
            const now = new Date().toISOString();
            const status = {
                is_collecting: isCollecting,
                last_collection_start: isCollecting ? now : undefined,
                last_collection_end: !isCollecting ? now : undefined,
                last_collection_error: error
            };

            // 移除未定义的字段
            Object.keys(status).forEach(key => 
                status[key] === undefined && delete status[key]
            );

            const { error: updateError } = await this.supabase
                .from('system_status')
                .upsert({
                    id: 1,
                    ...status
                })
                .eq('id', 1);

            if (updateError) {
                console.error('更新系统状态失败:', updateError);
            }
        } catch (error) {
            console.error('更新系统状态时出错:', error);
        }
    }

    // 清理旧的数据包文件
    async cleanOldPackages() {
        try {
            const packageDir = path.join(process.cwd(), 'public', 'packages');
            
            // 确保目录存在
            try {
                await fs.mkdir(packageDir, { recursive: true });
            } catch (error) {
                if (error.code !== 'EEXIST') {
                    console.error('创建目录失败:', error);
                    return;
                }
            }

            // 读取目录中的所有文件
            const files = await fs.readdir(packageDir);
            
            // 获取当前使用的数据包路径
            const { data, error } = await this.supabase
                .from('game_data')
                .select('package_path')
                .eq('is_active', true)
                .single();

            if (error) {
                console.error('获取当前数据包路径失败:', error);
                return;
            }

            const currentPackage = data?.package_path ? path.basename(data.package_path) : null;

            // 删除非当前使用的数据包文件
            for (const file of files) {
                if (file !== currentPackage && file.endsWith('.zip')) {
                    try {
                        await fs.unlink(path.join(packageDir, file));
                        console.log(`已删除旧的数据包文件: ${file}`);
                    } catch (error) {
                        console.error(`删除文件失败 ${file}:`, error);
                    }
                }
            }
        } catch (error) {
            console.error('清理旧数据包失败:', error);
        }
    }
}

module.exports = GameCollector; 