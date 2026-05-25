/**
 * 头像工具（需求7）——纯函数，仅依赖 fs/path，便于单元测试且不产生循环依赖。
 *
 * 头像 id 形如 'avatar-07'，对应 public/avatars/avatar-07.svg。
 */
const fs   = require('fs');
const path = require('path');

const AVATAR_DIR = path.join(__dirname, '..', 'public', 'avatars');

/** 扫描目录，返回排序后的头像 id 列表（去掉 .svg 扩展名） */
function listAvatars(dir = AVATAR_DIR) {
  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch (e) {
    return [];
  }
  return entries
    .filter(f => f.toLowerCase().endsWith('.svg'))
    .map(f => f.replace(/\.svg$/i, ''))
    .sort((a, b) => a.localeCompare(b, 'en'));
}

/** 校验头像 id：命名合法（防目录穿越）且确实存在于目录中 */
function isValidAvatar(id, dir = AVATAR_DIR) {
  if (!id || typeof id !== 'string') return false;
  if (!/^avatar-\d{2,}$/.test(id)) return false;   // 只允许我们生成的命名，杜绝路径穿越
  return listAvatars(dir).includes(id);
}

/** 为没有头像的用户按种子稳定分配一个默认头像，避免随机抖动；目录为空返回 null */
function defaultAvatar(seed, dir = AVATAR_DIR) {
  const list = listAvatars(dir);
  if (!list.length) return null;
  let h = 0;
  const s = String(seed || '');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return list[h % list.length];
}

module.exports = { AVATAR_DIR, listAvatars, isValidAvatar, defaultAvatar };
