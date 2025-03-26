-- 删除现有表（如果存在）
DROP TABLE IF EXISTS public.system_status;
DROP TABLE IF EXISTS public.download_stats;
DROP TABLE IF EXISTS public.games;
DROP TABLE IF EXISTS public.game_data;

-- 删除现有函数（如果存在）
DROP FUNCTION IF EXISTS public.update_updated_at_column();

-- 创建 game_data 表
CREATE TABLE public.game_data (
    id BIGSERIAL PRIMARY KEY,
    json_data JSONB NOT NULL,
    full_package BYTEA,
    total_games INTEGER NOT NULL,
    is_active BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 为 game_data 表添加字段注释
COMMENT ON COLUMN public.game_data.id IS '主键ID';
COMMENT ON COLUMN public.game_data.json_data IS '游戏数据JSON';
COMMENT ON COLUMN public.game_data.full_package IS '完整数据包（ZIP格式）';
COMMENT ON COLUMN public.game_data.total_games IS '游戏总数';
COMMENT ON COLUMN public.game_data.is_active IS '是否为最新数据';
COMMENT ON COLUMN public.game_data.created_at IS '创建时间';
COMMENT ON COLUMN public.game_data.updated_at IS '更新时间';

-- 创建 games 表
CREATE TABLE public.games (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    url TEXT NOT NULL UNIQUE,
    embed_url TEXT NOT NULL,
    description TEXT,
    category TEXT,
    icons JSONB,
    is_collected BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 为 games 表添加字段注释
COMMENT ON COLUMN public.games.id IS '主键ID';
COMMENT ON COLUMN public.games.name IS '游戏名称';
COMMENT ON COLUMN public.games.url IS '游戏URL';
COMMENT ON COLUMN public.games.embed_url IS '游戏嵌入地址';
COMMENT ON COLUMN public.games.description IS '游戏描述';
COMMENT ON COLUMN public.games.category IS '游戏类别';
COMMENT ON COLUMN public.games.icons IS '游戏图标数据';
COMMENT ON COLUMN public.games.is_collected IS '是否已采集';
COMMENT ON COLUMN public.games.created_at IS '创建时间';
COMMENT ON COLUMN public.games.updated_at IS '更新时间';

-- 创建 download_stats 表
CREATE TABLE public.download_stats (
    id BIGSERIAL PRIMARY KEY,
    download_type TEXT NOT NULL CHECK (download_type IN ('json', 'full')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 为 download_stats 表添加字段注释
COMMENT ON COLUMN public.download_stats.id IS '主键ID';
COMMENT ON COLUMN public.download_stats.download_type IS '下载类型：json或完整包';
COMMENT ON COLUMN public.download_stats.created_at IS '创建时间';
COMMENT ON COLUMN public.download_stats.updated_at IS '更新时间';

-- 创建系统状态表
CREATE TABLE public.system_status (
    id BIGSERIAL PRIMARY KEY,
    is_collecting BOOLEAN DEFAULT false,
    last_collection_start TIMESTAMP WITH TIME ZONE,
    last_collection_end TIMESTAMP WITH TIME ZONE,
    last_collection_error TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 为 system_status 表添加字段注释
COMMENT ON COLUMN public.system_status.id IS '主键ID';
COMMENT ON COLUMN public.system_status.is_collecting IS '是否正在采集';
COMMENT ON COLUMN public.system_status.last_collection_start IS '上次采集开始时间';
COMMENT ON COLUMN public.system_status.last_collection_end IS '上次采集结束时间';
COMMENT ON COLUMN public.system_status.last_collection_error IS '上次采集错误信息';
COMMENT ON COLUMN public.system_status.created_at IS '创建时间';
COMMENT ON COLUMN public.system_status.updated_at IS '更新时间';

-- 创建索引
CREATE INDEX idx_game_data_is_active ON public.game_data(is_active);
CREATE INDEX idx_game_data_created_at ON public.game_data(created_at);
CREATE INDEX idx_games_name ON public.games(name);
CREATE INDEX idx_games_category ON public.games(category);
CREATE INDEX idx_games_is_collected ON public.games(is_collected);
CREATE INDEX idx_games_created_at ON public.games(created_at);
CREATE INDEX idx_download_stats_download_type ON public.download_stats(download_type);
CREATE INDEX idx_download_stats_created_at ON public.download_stats(created_at);
CREATE INDEX idx_system_status_is_collecting ON public.system_status(is_collecting);

-- 创建更新时间触发器函数
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- 为所有表添加触发器
DROP TRIGGER IF EXISTS update_game_data_updated_at ON public.game_data;
CREATE TRIGGER update_game_data_updated_at
    BEFORE UPDATE ON public.game_data
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_games_updated_at ON public.games;
CREATE TRIGGER update_games_updated_at
    BEFORE UPDATE ON public.games
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_download_stats_updated_at ON public.download_stats;
CREATE TRIGGER update_download_stats_updated_at
    BEFORE UPDATE ON public.download_stats
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_system_status_updated_at ON public.system_status;
CREATE TRIGGER update_system_status_updated_at
    BEFORE UPDATE ON public.system_status
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

-- 创建 RLS 策略
ALTER TABLE public.game_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.games ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.download_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_status ENABLE ROW LEVEL SECURITY;

-- 允许匿名用户读取数据
CREATE POLICY "Allow anonymous read access to game_data"
    ON public.game_data
    FOR SELECT
    TO anon
    USING (true);

CREATE POLICY "Allow anonymous read access to games"
    ON public.games
    FOR SELECT
    TO anon
    USING (true);

CREATE POLICY "Allow anonymous read access to download_stats"
    ON public.download_stats
    FOR SELECT
    TO anon
    USING (true);

CREATE POLICY "Allow anonymous read access to system_status"
    ON public.system_status
    FOR SELECT
    TO anon
    USING (true);

-- 允许服务角色完全访问
CREATE POLICY "Allow service role full access to game_data"
    ON public.game_data
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Allow service role full access to games"
    ON public.games
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Allow service role full access to download_stats"
    ON public.download_stats
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Allow service role full access to system_status"
    ON public.system_status
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- 初始化系统状态
INSERT INTO public.system_status (id, is_collecting, last_collection_start, last_collection_end)
VALUES (1, false, NULL, NULL)
ON CONFLICT DO NOTHING;

-- 创建事务管理函数
CREATE OR REPLACE FUNCTION public.begin_transaction()
RETURNS void AS $$
BEGIN
    PERFORM pg_advisory_xact_lock(1);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.commit_transaction()
RETURNS void AS $$
BEGIN
    -- 提交事务由 PostgreSQL 自动处理
    RETURN;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.rollback_transaction()
RETURNS void AS $$
BEGIN
    -- 回滚事务由 PostgreSQL 自动处理
    RAISE EXCEPTION 'Transaction rollback requested';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 为事务函数添加注释
COMMENT ON FUNCTION public.begin_transaction() IS '开始数据库事务';
COMMENT ON FUNCTION public.commit_transaction() IS '提交数据库事务';
COMMENT ON FUNCTION public.rollback_transaction() IS '回滚数据库事务';

-- 授予执行权限
GRANT EXECUTE ON FUNCTION public.begin_transaction() TO service_role;
GRANT EXECUTE ON FUNCTION public.commit_transaction() TO service_role;
GRANT EXECUTE ON FUNCTION public.rollback_transaction() TO service_role;

-- 创建检查采集时间间隔的函数
CREATE OR REPLACE FUNCTION public.should_collect_data()
RETURNS BOOLEAN AS $$
DECLARE
    last_end_time TIMESTAMP WITH TIME ZONE;
BEGIN
    -- 获取上次采集结束时间
    SELECT last_collection_end INTO last_end_time
    FROM public.system_status
    WHERE id = 1;

    -- 如果没有上次采集记录，或者距离上次采集超过1小时，返回 true
    RETURN (
        last_end_time IS NULL OR
        (CURRENT_TIMESTAMP - last_end_time) > INTERVAL '1 hour'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 创建批量更新游戏数据的函数
CREATE OR REPLACE FUNCTION public.batch_update_games(games_json JSONB)
RETURNS void AS $$
BEGIN    
    -- 清空 games 表
    TRUNCATE TABLE public.games;
    
    -- 批量插入新数据
    INSERT INTO public.games (
        name, url, embed_url, description, category, icons, is_collected
    )
    SELECT 
        (value->>'name')::TEXT,
        (value->>'url')::TEXT,
        (value->>'embed_url')::TEXT,
        (value->>'description')::TEXT,
        (value->>'category')::TEXT,
        (value->'icons')::JSONB,
        true
    FROM jsonb_array_elements(games_json);

EXCEPTION
    WHEN OTHERS THEN
        RAISE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 创建更新采集数据的函数
CREATE OR REPLACE FUNCTION public.update_collection_data(
    games_json JSONB,
    zip_data BYTEA,
    total_count INTEGER
)
RETURNS void AS $$
BEGIN
    -- 将所有现有记录标记为非活动
    UPDATE public.game_data
    SET is_active = false
    WHERE is_active = true;
    
    -- 插入新的数据记录
    INSERT INTO public.game_data (
        json_data,
        full_package,
        total_games,
        is_active
    ) VALUES (
        games_json,
        zip_data,
        total_count,
        true
    );
    
    -- 更新系统状态
    UPDATE public.system_status
    SET 
        is_collecting = false,
        last_collection_end = CURRENT_TIMESTAMP
    WHERE id = 1;

EXCEPTION
    WHEN OTHERS THEN
        RAISE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 为新函数添加注释
COMMENT ON FUNCTION public.should_collect_data() IS '检查是否需要执行数据采集';
COMMENT ON FUNCTION public.batch_update_games(JSONB) IS '批量更新游戏数据';
COMMENT ON FUNCTION public.update_collection_data(JSONB, BYTEA, INTEGER) IS '更新采集数据和系统状态';

-- 授予执行权限
GRANT EXECUTE ON FUNCTION public.should_collect_data() TO service_role;
GRANT EXECUTE ON FUNCTION public.batch_update_games(JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_collection_data(JSONB, BYTEA, INTEGER) TO service_role; 