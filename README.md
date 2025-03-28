# HTML5 Games 采集器

这是一个用于采集 html5games.com 网站游戏信息的工具，支持浏览器插件和本地运行两种方式。

## 浏览器插件使用方式

1. 打开Chrome浏览器，进入扩展程序页面（chrome://extensions/）
2. 开启"开发者模式"
3. 点击"加载已解压的扩展程序"，选择本项目的文件夹
4. 访问 html5games.com 网站
5. 点击浏览器工具栏中的插件图标
6. 点击"开始采集"按钮开始采集数据
7. 采集完成后，点击"下载数据"按钮保存JSON文件

## 本地运行方式

1. 确保已安装Python 3.6或更高版本
2. 安装必要的Python包：
   ```bash
   pip install requests
   ```
3. 将浏览器插件导出的JSON文件重命名为 `html5games_data.json`
4. 运行Python脚本：
   ```bash
   python process_data.py
   ```
5. 脚本会自动创建目录结构并生成汇总文件

## 输出结果

处理完成后，将在当前目录下创建以下结构：

```
games/
├── games_summary.md  # 游戏信息汇总文件
└── 分类目录/        # 按游戏分类组织
    └── 游戏名称/
        ├── icon_180x180.png
        ├── icon_120x120.png
        └── icon_60x60.png
```

games_summary.md 文件格式如下：
```markdown
# 游戏信息汇总

## 分类名称
### 游戏名称
- 游戏链接：[游戏名称](游戏URL)
- 嵌入地址：游戏嵌入URL
- 游戏分类：分类1, 分类2
- 游戏描述：游戏的详细描述文本
- 游戏图标：
  - [180x180](分类名称/游戏名称/icon_180x180.png)
  - [120x120](分类名称/游戏名称/icon_120x120.png)
  - [60x60](分类名称/游戏名称/icon_60x60.png)
```

## 注意事项

1. 使用浏览器插件时，请确保在 html5games.com 网站上使用
2. 采集过程中请勿关闭浏览器或刷新页面
3. 如果遇到网络问题，可以重试采集
4. 本地处理时请确保有足够的磁盘空间 