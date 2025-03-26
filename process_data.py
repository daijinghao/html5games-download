import json
import os
import requests
from urllib.parse import urlparse
import re
import shutil
from pathlib import Path

def sanitize_filename(filename):
    # 移除不允许的字符
    return re.sub(r'[<>:"/\\|?*]', '', filename)

def download_image(url, save_path):
    try:
        response = requests.get(url, stream=True)
        if response.status_code == 200:
            with open(save_path, 'wb') as f:
                response.raw.decode_content = True
                shutil.copyfileobj(response.raw, f)
            return True
    except Exception as e:
        print(f"下载图片失败 {url}: {str(e)}")
    return False

def process_data(json_file):
    # 读取JSON数据
    with open(json_file, 'r', encoding='utf-8') as f:
        data = json.load(f)

    # 创建基础目录
    base_dir = Path('games')
    base_dir.mkdir(exist_ok=True)

    # 创建汇总文件
    summary_file = base_dir / 'games_summary.md'
    with open(summary_file, 'w', encoding='utf-8') as f:
        f.write('# 游戏信息汇总\n\n')

    # 处理每个游戏
    for game in data['games']:
        if not game['categories']:
            continue

        # 使用第一个分类作为主分类
        category = game['categories'][0]
        category_dir = base_dir / sanitize_filename(category)
        category_dir.mkdir(exist_ok=True)

        # 创建游戏目录
        game_dir = category_dir / sanitize_filename(game['name'])
        game_dir.mkdir(exist_ok=True)

        # 下载图标
        icon_sizes = {
            'large': '180x180',
            'medium': '120x120',
            'small': '60x60'
        }

        for size_key, size in icon_sizes.items():
            if game['icons'][size_key]:
                icon_path = game_dir / f'icon_{size}.png'
                download_image(game['icons'][size_key], icon_path)

        # 更新汇总文件
        with open(summary_file, 'a', encoding='utf-8') as f:
            f.write(f'## {category}\n')
            f.write(f'### {game["name"]}\n')
            f.write(f'- 游戏链接：[{game["name"]}]({game["url"]})\n')
            f.write(f'- 嵌入地址：{game["embedUrl"]}\n')
            f.write(f'- 游戏分类：{", ".join(game["categories"])}\n')
            f.write(f'- 游戏描述：{game["description"]}\n')
            f.write('- 游戏图标：\n')
            for size_key, size in icon_sizes.items():
                if game['icons'][size_key]:
                    f.write(f'  - [{size}]({game_dir.name}/icon_{size}.png)\n')
            f.write('\n')

if __name__ == '__main__':
    json_file = 'html5games_data.json'
    if os.path.exists(json_file):
        process_data(json_file)
        print('数据处理完成！')
    else:
        print(f'未找到数据文件：{json_file}') 