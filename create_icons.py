from PIL import Image, ImageDraw, ImageFont
import os

def create_icon(size):
    # 创建一个新的图片，使用RGBA模式（支持透明度）
    image = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    
    # 绘制背景
    draw.rectangle([0, 0, size, size], fill='#4CAF50')
    
    # 绘制文字
    try:
        font_size = size // 2
        font = ImageFont.truetype("arial.ttf", font_size)
    except:
        font = ImageFont.load_default()
    
    text = "G"
    text_bbox = draw.textbbox((0, 0), text, font=font)
    text_width = text_bbox[2] - text_bbox[0]
    text_height = text_bbox[3] - text_bbox[1]
    
    x = (size - text_width) // 2
    y = (size - text_height) // 2
    
    draw.text((x, y), text, fill='white', font=font)
    
    return image

def main():
    # 确保icons文件夹存在
    if not os.path.exists('icons'):
        os.makedirs('icons')
    
    # 生成不同尺寸的图标
    sizes = [16, 48, 128]
    for size in sizes:
        icon = create_icon(size)
        icon.save(f'icons/icon{size}.png')
        print(f'已生成 {size}x{size} 图标')

if __name__ == '__main__':
    main() 