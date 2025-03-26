const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const GameCollector = require('./collector');
const path = require('path');
const fs = require('fs').promises;
const { createReadStream } = require('fs');

const router = express.Router();
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const collector = new GameCollector(supabase);

// 获取系统状态
router.get('/status', async (req, res) => {
    try {
        const { data: statusData, error: statusError } = await supabase
            .from('system_status')
            .select('*')
            .eq('id', 1)
            .single();

        if (statusError) throw statusError;

        // 获取当前活跃的游戏数据记录
        const { data: gameData, error: gameError } = await supabase
            .from('game_data')
            .select('total_games, updated_at')
            .eq('is_active', true)
            .single();

        if (gameError && gameError.code !== 'PGRST116') throw gameError;

        const response = {
            is_collecting: statusData.is_collecting,
            last_collection_start: statusData.last_collection_start,
            last_collection_end: statusData.last_collection_end,
            last_collection_error: statusData.last_collection_error,
            total_games: gameData?.total_games || 0,
            last_update: gameData?.updated_at || null
        };

        res.json(response);
    } catch (error) {
        console.error('获取状态失败:', error);
        res.status(500).json({
            success: false,
            error: '获取状态失败',
            details: error.message
        });
    }
});

// 开始采集
router.post('/collect', async (req, res) => {
    try {
        const shouldCollect = await collector.shouldCollectData();
        if (!shouldCollect) {
            return res.json({
                success: true,
                message: '距离上次采集未超过1小时，跳过采集',
                should_collect: false
            });
        }

        // 启动采集过程
        collector.startCollecting()
            .then(() => {
                console.log('采集任务完成');
            })
            .catch(error => {
                console.error('采集任务失败:', error);
            });

        res.json({
            success: true,
            message: '采集任务已启动',
            should_collect: true
        });
    } catch (error) {
        console.error('启动采集失败:', error);
        res.status(500).json({
            success: false,
            error: '启动采集失败',
            details: error.message
        });
    }
});

// 下载 JSON 数据
router.get('/download/json', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('game_data')
            .select('json_data')
            .eq('is_active', true)
            .single();

        if (error) throw error;
        if (!data || !data.json_data) {
            throw new Error('没有可用的游戏数据');
        }

        // 格式化 JSON 数据
        const formattedJson = JSON.stringify(data.json_data, null, 2);

        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename=games_${new Date().toISOString().split('T')[0]}.json`);
        res.send(formattedJson);
    } catch (error) {
        console.error('下载 JSON 数据失败:', error);
        res.status(500).json({
            success: false,
            error: '下载 JSON 数据失败',
            details: error.message
        });
    }
});

// 下载完整数据包
router.get('/download/package', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('game_data')
            .select('package_path')
            .eq('is_active', true)
            .single();

        if (error) throw error;
        if (!data || !data.package_path) {
            throw new Error('没有可用的数据包');
        }

        // 构建文件路径
        const filePath = path.join(__dirname, '../../..', 'public', data.package_path.replace(/^\//, ''));
        console.log('尝试读取数据包文件:', filePath);

        // 检查文件是否存在
        try {
            await fs.access(filePath);
        } catch (error) {
            console.error('文件访问失败:', error);
            return res.status(404).json({
                success: false,
                error: '数据包文件不存在'
            });
        }

        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename=games_${new Date().toISOString().split('T')[0]}.zip`);
        
        // 使用文件流发送文件
        const fileStream = createReadStream(filePath);
        fileStream.on('error', (error) => {
            console.error('文件流错误:', error);
            if (!res.headersSent) {
                res.status(500).json({
                    success: false,
                    error: '读取数据包失败',
                    details: error.message
                });
            }
        });
        fileStream.pipe(res);
    } catch (error) {
        console.error('下载数据包失败:', error);
        res.status(500).json({
            success: false,
            error: '下载数据包失败',
            details: error.message
        });
    }
});

// 检查下载状态
router.get('/status/download', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('game_data')
            .select('json_data, package_path')
            .eq('is_active', true)
            .single();

        if (error) {
            console.error('获取下载状态失败:', error);
            throw error;
        }

        // 返回下载状态
        res.json({
            json_ready: Boolean(data?.json_data),
            package_ready: Boolean(data?.package_path)  // 只有当 package_path 存在时才返回 true
        });
    } catch (error) {
        console.error('检查下载状态失败:', error);
        res.status(500).json({
            success: false,
            error: '检查下载状态失败',
            details: error.message
        });
    }
});

module.exports = router; 