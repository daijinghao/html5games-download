const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing Supabase configuration. Please check your .env file.');
}

console.log('Supabase 配置信息:', {
    url: supabaseUrl,
    hasServiceKey: !!supabaseKey
});

// 创建 Supabase 客户端
const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: {
        persistSession: false
    },
    db: {
        schema: 'public'
    }
});

// 测试连接
async function testConnection() {
    try {
        const { data, error } = await supabase
            .from('system_status')
            .select('*')
            .limit(1);
            
        if (error) throw error;
        
        console.log('Supabase 连接测试成功:', { 
            hasData: !!data, 
            rowCount: data ? data.length : 0 
        });
        
        return true;
    } catch (error) {
        console.error('Supabase 连接测试失败:', error);
        return false;
    }
}

// 添加重试机制的包装函数
async function withRetry(operation, maxRetries = 3, delay = 1000) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await operation();
        } catch (error) {
            console.error(`操作失败 (尝试 ${attempt}/${maxRetries}):`, {
                message: error.message,
                code: error.code,
                details: error.details,
                hint: error.hint
            });

            if (attempt === maxRetries) {
                throw error;
            }

            // 指数退避延迟
            const waitTime = delay * Math.pow(2, attempt - 1);
            console.log(`等待 ${waitTime}ms 后重试...`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }
    }
}

// 执行连接测试
testConnection().catch(error => {
    console.error('初始化 Supabase 客户端失败:', error);
});

// 为 supabase 客户端添加辅助方法
supabase.withRetry = withRetry;
supabase.testConnection = testConnection;

module.exports = supabase; 