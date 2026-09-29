# 本地文件转换器

一个纯浏览器端的文件转换工具，黑白极简设计，响应式布局。**所有转换均在本地完成，文件不会上传到任何服务器。**

在线使用：https://weather-source.github.io/file-converter/

## 支持的转换

| 类型 | 输入 | 输出 |
|------|------|------|
| 图片 | PNG / JPG / WEBP / GIF / BMP / ICO / SVG / AVIF | PNG / JPEG / WEBP / BMP / ICO（多尺寸） |
| 文档 | Markdown / TXT / HTML / CSV / JSON | 相互转换（如 MD↔HTML、CSV↔JSON、MD→TXT 等） |

## 特性

- 纯前端实现，零依赖、零后端，可离线使用
- 拖拽 / 点击 / Ctrl+V 粘贴添加文件，支持批量转换
- JPEG / WEBP 输出质量可调
- 黑白极简 UI，桌面端与移动端自适应

## 本地运行

直接打开 `index.html`，或：

```bash
python -m http.server 8080
# 访问 http://localhost:8080
```
