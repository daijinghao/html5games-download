const express = require('express');
const path = require('path');
const cors = require('cors');
const schedule = require('node-schedule');
const supabase = require('./db/supabase');
const GameCollector = require('./api/collector');
const fs = require('fs').promises;
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// 创建采集器实例
const collector = new GameCollector();

// 中间件
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../client')));

// API 路由
app.use('/api', require('./api'));

// 错误处理中间件
app.use((err, req, res, next) => {
    console.error('服务器错误:', err);
    res.status(500).json({
        success: false,
        error: '服务器内部错误',
        details: err.message
    });
});

// 启动服务器
app.listen(port, async () => {
    console.log(`服务器运行在 http://localhost:${port}`);
    
    // 重置系统状态
    try {
        await supabase
            .from('system_status')
            .update({ is_collecting: false })
            .eq('id', 1);
        console.log('系统状态已重置');
    } catch (error) {
        console.error('重置系统状态失败:', error);
    }
    
    // 检查是否存在 ZIP 文件
    try {
        const { data, error } = await supabase
            .from('game_data')
            .select('package_path')
            .eq('is_active', true)
            .single();

        if (error || !data || !data.package_path) {
            console.log('未找到数据包文件，开始初始数据采集...');
            await collector.startCollecting();
            console.log('初始数据采集完成');
        } else {
            // 检查文件是否实际存在
            const filePath = path.join(__dirname, '../..', 'public', data.package_path.replace(/^\//, ''));
            try {
                await fs.access(filePath);
                console.log('数据包文件已存在，跳过初始采集');
            } catch (error) {
                console.log('数据包文件不存在，开始初始数据采集...');
                await collector.startCollecting();
                console.log('初始数据采集完成');
            }
        }
    } catch (error) {
        console.error('初始数据采集失败:', error);
    }
    
    // 设置定时任务，每天凌晨3点更新一次数据
    schedule.scheduleJob('0 3 * * *', async () => {
        try {
            console.log('开始定时数据更新...');
            await collector.startCollecting();
            console.log('定时数据更新完成');
        } catch (error) {
            console.error('定时数据更新失败:', error);
        }
    });
}); 