const express = require('express');
const path = require('path');
const cors = require('cors');
const schedule = require('node-schedule');
const supabase = require('./db/supabase');
const GameCollector = require('./api/collector');
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
    
    // 启动时执行一次数据采集
    try {
        console.log('服务器启动，开始初始数据采集...');
        await collector.startCollecting();
        console.log('初始数据采集完成');
    } catch (error) {
        console.error('初始数据采集失败:', error);
    }
    
    // 设置定时任务，每小时更新一次数据
    schedule.scheduleJob('0 * * * *', async () => {
        try {
            console.log('开始定时数据更新...');
            await collector.startCollecting();
            console.log('定时数据更新完成');
        } catch (error) {
            console.error('定时数据更新失败:', error);
        }
    });
}); 