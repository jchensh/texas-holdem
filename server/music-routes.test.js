const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');

const { listAudioFiles, prettifyName } = require('./music-routes');

// 在系统临时目录建一个隔离的测试目录，写入若干文件后扫描
function makeTempDir(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'poker-audio-'));
  for (const f of files) fs.writeFileSync(path.join(dir, f), 'x');
  return dir;
}

test('listAudioFiles 只返回 .mp3，过滤掉其它文件', () => {
  const dir = makeTempDir(['a.mp3', 'b.txt', 'readme.md', 'c.MP3']);
  const tracks = listAudioFiles(dir);
  const files = tracks.map(t => t.file).sort();
  assert.deepStrictEqual(files, ['a.mp3', 'c.MP3'], '只保留 mp3（大小写不敏感）');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('listAudioFiles 按文件名排序', () => {
  const dir = makeTempDir(['03.mp3', '01.mp3', '02.mp3']);
  const names = listAudioFiles(dir).map(t => t.file);
  assert.deepStrictEqual(names, ['01.mp3', '02.mp3', '03.mp3']);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('listAudioFiles 生成正确的 url（含空格/中文需编码）', () => {
  const dir = makeTempDir(['smooth jazz.mp3']);
  const t = listAudioFiles(dir)[0];
  assert.strictEqual(t.url, '/audio/smooth%20jazz.mp3', 'url 应对文件名做 encodeURIComponent');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('listAudioFiles 目录不存在时返回空数组（前端据此回退兜底）', () => {
  const tracks = listAudioFiles(path.join(os.tmpdir(), 'definitely-not-exist-' + Date.now()));
  assert.deepStrictEqual(tracks, []);
});

test('prettifyName 去扩展名、连字符转空格、英文首字母大写', () => {
  assert.strictEqual(prettifyName('smooth-jazz_01.mp3'), 'Smooth Jazz 01');
  assert.strictEqual(prettifyName('demo-01.mp3'), 'Demo 01');
});
