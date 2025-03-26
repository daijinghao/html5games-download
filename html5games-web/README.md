# HTML5Games 数据采集网站

这是一个用于采集和下载 HTML5Games.com 游戏数据的网站。

## 功能特点

- 自动采集 HTML5Games.com 的游戏数据（每小时自动更新）
- 支持下载 JSON 数据和完整数据包（包含图标）
- 实时显示系统状态和采集进度
- 记录下载统计
- 多语言支持（开发中）

## 技术栈

- 前端：HTML5, CSS3, JavaScript
- 后端：Node.js, Express
- 数据库：Supabase (PostgreSQL)
- 工具：JSZip, node-schedule

## 安装和运行

1. 克隆项目：
   ```bash
   git clone [项目地址]
   cd html5games-web
   ```

2. 安装依赖：
   ```bash
   npm install
   ```

3. 配置环境变量：
   - 复制 `.env.example` 为 `.env`
   - 填入 Supabase 配置信息：
     ```
     SUPABASE_URL=你的项目URL
     SUPABASE_ANON_KEY=你的匿名密钥
     SUPABASE_SERVICE_ROLE_KEY=你的服务角色密钥
     ```

4. 启动服务器：
   ```bash
   # 开发模式
   npm run dev

   # 生产模式
   npm start
   ```

5. 访问网站：
   打开浏览器访问 `http://localhost:3000`

## 数据库表结构

### game_data 表 (public schema)
- id: bigint (主键)
- json_data: jsonb (游戏数据)
- full_package: bytea (ZIP压缩包)
- total_games: integer (游戏总数)
- is_active: boolean (是否为最新数据)
- created_at: timestamp with time zone
- updated_at: timestamp with time zone

### games 表 (public schema)
- id: bigint (主键)
- name: text (游戏名称)
- url: text (游戏URL)
- embed_url: text (游戏嵌入地址)
- description: text (游戏描述)
- category: text (游戏类别)
- icons: jsonb (游戏图标数据)
- is_collected: boolean (是否已采集)
- created_at: timestamp with time zone
- updated_at: timestamp with time zone

### download_stats 表 (public schema)
- id: bigint (主键)
- download_type: text ('json' 或 'full')
- created_at: timestamp with time zone
- updated_at: timestamp with time zone

### system_status 表 (public schema)
- id: bigint (主键)
- is_collecting: boolean (是否正在采集)
- last_collection_start: timestamp with time zone (上次采集开始时间)
- last_collection_end: timestamp with time zone (上次采集结束时间)
- last_collection_error: text (上次采集错误信息)
- created_at: timestamp with time zone
- updated_at: timestamp with time zone

## 数据库初始化

项目包含一个 `init.sql` 文件，其中包含所有必要的数据库表结构、索引、触发器和安全策略。你可以直接在 Supabase 的 SQL 编辑器中运行此文件来初始化数据库。

## API 接口

### 获取状态
```
GET /api/status
返回：
{
    data: {
        totalGames: number,
        lastUpdate: string,
        downloads: {
            json: number,
            full: number
        }
    },
    isCollecting: boolean,
    lastCollectionStart: string,
    lastCollectionEnd: string,
    lastCollectionError: string
}
```

### 下载 JSON 数据
```
GET /api/download/json
返回：JSON 格式的游戏数据
```

### 下载完整数据包
```
GET /api/download/full
返回：ZIP 格式的完整数据包
```

## 注意事项

1. 系统会自动每小时更新一次游戏数据
2. 数据采集过程中，下载按钮将被禁用
3. 采集完成后，系统会自动更新数据库，并将旧数据标记为非活动
4. 下载统计会记录每次下载的类型和时间
5. 完整数据包包含所有游戏数据和图标，文件较大，下载可能需要一些时间

## 许可证

MIT