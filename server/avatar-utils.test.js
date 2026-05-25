const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');

const { listAvatars, isValidAvatar, defaultAvatar } = require('./avatar-utils');

function makeTempDir(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'poker-avatars-'));
  for (const f of files) fs.writeFileSync(path.join(dir, f), '<svg/>');
  return dir;
}

test('listAvatars 只返回 .svg 的 id（去扩展名）并排序', () => {
  const dir = makeTempDir(['avatar-02.svg', 'avatar-01.svg', 'notes.txt']);
  assert.deepStrictEqual(listAvatars(dir), ['avatar-01', 'avatar-02']);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('listAvatars 目录不存在时返回空数组', () => {
  assert.deepStrictEqual(listAvatars(path.join(os.tmpdir(), 'nope-' + Date.now())), []);
});

test('isValidAvatar：存在且命名合法才通过', () => {
  const dir = makeTempDir(['avatar-01.svg', 'avatar-02.svg']);
  assert.strictEqual(isValidAvatar('avatar-01', dir), true);
  assert.strictEqual(isValidAvatar('avatar-99', dir), false, '不存在的不通过');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('isValidAvatar：拒绝非法/路径穿越输入', () => {
  const dir = makeTempDir(['avatar-01.svg']);
  assert.strictEqual(isValidAvatar('../../etc/passwd', dir), false);
  assert.strictEqual(isValidAvatar('avatar-01.svg', dir), false, '不应带扩展名');
  assert.strictEqual(isValidAvatar('', dir), false);
  assert.strictEqual(isValidAvatar(null, dir), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('defaultAvatar：同一种子稳定返回同一个，且落在列表内', () => {
  const dir = makeTempDir(['avatar-01.svg', 'avatar-02.svg', 'avatar-03.svg']);
  const a = defaultAvatar('alice', dir);
  const b = defaultAvatar('alice', dir);
  assert.strictEqual(a, b, '同种子稳定');
  assert.ok(['avatar-01', 'avatar-02', 'avatar-03'].includes(a));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('defaultAvatar：空目录返回 null', () => {
  const dir = makeTempDir([]);
  assert.strictEqual(defaultAvatar('x', dir), null);
  fs.rmSync(dir, { recursive: true, force: true });
});
