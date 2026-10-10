# 🎂 生日快乐交响曲（Patatap 风格互动祝福页）

参考 [patatap.com](https://patatap.com) 的互动形式做的生日祝福网页：
**每个键都有专属的声音和动画**，用键盘为 TA 敲出一场生日演奏。

线上地址：**https://bowentown.github.io/birthday/**

## 玩法

| 操作 | 效果 |
| --- | --- |
| `A` – `Z` | 每个字母键一段歌声切片 + 专属动画（按 A→Z 顺序敲 ≈ 完整放一遍歌） |
| `1` – `8` | 五声音阶拨弦（怎么按都和谐），配上升起的气球 |
| `空格` | 🎉 大惊喜：HAPPY BIRTHDAY 横幅 + 全屏彩带雨 |
| `回车` | 🎵 自动演奏《祝你生日快乐》，结束后撒花 |
| 手机 | 直接点屏幕任意位置，指尖炸出声音和动画 |

右上角 🔊 可随时静音。

## 定制

- **祝福对象**：专属定制版 —— 开场显示「祝崔师傅生日快乐 🎂」，惊喜横幅显示「汪师傅和桃桃桃祝崔师傅生日快乐 🎂」
- **换人**：改动 `script.js` 顶部的 `NAME`（寿星）和 `FROM`（祝福人）两个常量即可
- **换歌**：替换 `assets/song.m4a` 即可（页面实际加载的是 128kbps AAC 轻量版，加载快）；原始 320kbps 的 `assets/song.mp3` 仍保留在仓库里作母带。若用其他格式，记得同步改 `script.js` 里的 fetch 地址。
- 歌曲没加载好（或加载失败）时会自动切换成 WebAudio 合成音色兜底，永远不会冷场；加载进度会显示在左下角。

## 技术

- 纯静态 HTML + CSS + 原生 JS，**无构建、无依赖、无框架**
- 音频：fetch + `decodeAudioData` 解码整首歌，每个键映射一段切片（偏移 / 时长 / 变速都由确定性伪随机生成，同一键音色恒定）；合成音色走 ConvolverNode 算法混响
- 动画：双画布 —— 背景层星空 + 流星，动画层"淡出擦除"渲染出辉光拖尾，霓虹质感
- 彩带：[canvas-confetti](https://github.com/catdad/canvas-confetti)（ISC License），空格惊喜 / 开场 / 自动演奏结尾的三连彩带炮都是它
- 移动端：触摸即演奏，`touch-action: none` 防滚动，DPR 自适应

## 目录结构

```
birthday/
├── index.html      # 页面结构
├── style.css       # 样式（开场遮罩 / HUD / 按键提示）
├── script.js       # 键位映射 / 音频切片引擎 / 全部动画
└── assets/
    ├── song.m4a                      # 页面实际加载的音频（128kbps AAC，加载快）
    ├── song.mp3                      # 原始 320kbps 母带（仓库保留）
    └── vendor/confetti.browser.min.js  # canvas-confetti（ISC License）
```

## 致谢

- 交互形式致敬 [patatap.com](https://patatap.com)（Jono Brandel × Lullatone），本仓库全部代码从零手写，仅借鉴"按键出声出动画"的玩法，未使用其任何素材
- 彩带效果使用 [canvas-confetti](https://github.com/catdad/canvas-confetti)（ISC License，作者 catdad），按协议随仓库分发
