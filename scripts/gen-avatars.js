/**
 * 生成 20 个占位头像 SVG 到 public/avatars/。
 *
 * 需求7：换头像。用纯代码生成，零外部依赖、零下载、矢量任意尺寸清晰。
 * 每个头像 = 双色渐变满底 + 居中白色符号；色相均匀铺开，符号各异，互相好区分。
 *
 * 用法：node scripts/gen-avatars.js
 * 产物：public/avatars/avatar-01.svg … avatar-20.svg（命名两位补零，便于排序）
 */
const fs   = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, '..', 'public', 'avatars');
const COUNT = 20;

// 20 个广泛可渲染的符号（扑克花色 / 棋子 / 星月等），与色相一一对应
const GLYPHS = [
  '♠', '♥', '♦', '♣', '★', '♛', '♚', '♞', '♜', '♝',
  '☘', '✦', '◆', '●', '▲', '■', '✿', '♪', '❄', '☀',
];

function svgFor(i) {
  const hue  = Math.round((360 / COUNT) * i);      // 色相均匀铺开
  const hue2 = (hue + 28) % 360;                   // 渐变第二色，略微偏移
  const glyph = GLYPHS[i % GLYPHS.length];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="hsl(${hue}, 68%, 56%)"/>
      <stop offset="1" stop-color="hsl(${hue2}, 70%, 38%)"/>
    </linearGradient>
  </defs>
  <rect width="256" height="256" fill="url(#g)"/>
  <text x="128" y="138" font-size="132" text-anchor="middle" dominant-baseline="central"
        fill="rgba(255,255,255,0.94)" font-family="'Segoe UI Symbol','Apple Color Emoji',Arial,sans-serif">${glyph}</text>
</svg>
`;
}

fs.mkdirSync(OUT_DIR, { recursive: true });
for (let i = 0; i < COUNT; i++) {
  const name = `avatar-${String(i + 1).padStart(2, '0')}.svg`;
  fs.writeFileSync(path.join(OUT_DIR, name), svgFor(i), 'utf8');
}
console.log(`[gen-avatars] 已生成 ${COUNT} 个头像 SVG 到 ${OUT_DIR}`);
