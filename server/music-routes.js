/**
 * 音乐库模块
 *
 * 提供：
 *   GET /api/music/playlist   扫描 public/audio/ 目录，返回 mp3 播放列表
 *
 * 设计要点：
 * - mp3 文件由人工放入 public/audio/；每次请求实时读目录，新增/删除文件无需重启服务。
 * - 无需登录即可访问——背景音乐在登录页也要能放。
 * - 扫描逻辑抽成纯函数 listAudioFiles(dir)，便于单元测试（可传入任意临时目录）。
 */
const express = require('express');
const fs      = require('fs');
const path    = require('path');

// 固定音乐目录：public/audio/
const AUDIO_DIR = path.join(__dirname, '..', 'public', 'audio');

/**
 * 把文件名转成展示用曲目名：去扩展名、连字符/下划线转空格、英文首字母大写。
 * 例：'smooth-jazz_01.mp3' -> 'Smooth Jazz 01'；中文文件名原样保留。
 *
 * @param {string} file 文件名（含扩展名）
 * @returns {string}
 */
function prettifyName(file) {
  return file
    .replace(/\.mp3$/i, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * 纯函数：扫描指定目录下的 mp3 文件，返回按文件名排序的曲目列表。
 *
 * @param {string} dir 要扫描的目录绝对路径
 * @returns {Array<{ file: string, name: string, url: string }>}
 */
function listAudioFiles(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch (e) {
    // 目录不存在 / 不可读时返回空列表，前端据此回退到 Web Audio 合成爵士乐兜底
    return [];
  }

  return entries
    .filter(f => f.toLowerCase().endsWith('.mp3'))
    .sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'))
    .map(file => ({
      file,
      name: prettifyName(file),
      // 静态文件已由 express.static 托管在 /audio/ 下；文件名可能含空格/中文，需编码
      url: `/audio/${encodeURIComponent(file)}`,
    }));
}

const router = express.Router();

router.get('/playlist', (_req, res) => {
  res.json({ tracks: listAudioFiles(AUDIO_DIR) });
});

module.exports = { router, listAudioFiles, prettifyName, AUDIO_DIR };
