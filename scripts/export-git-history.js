const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// 配置文件路径
const OUTPUT_FILE = path.join(__dirname, '..', 'GIT_HISTORY_CHANGELOG.md');

// 定义 Emoji 映射
const EMOJI_MAP = {
  feat: '🌟',
  fix: '🐛',
  docs: '📝',
  style: '🎨',
  refactor: '⚡',
  perf: '🚀',
  test: '🧪',
  build: '🛠️',
  ci: '🤖',
  chore: '🧹',
  revert: '⏪'
};

function getCommitEmoji(subject) {
  const match = subject.trim().match(/^([a-z]+)(?:\([a-z0-9-_./]+\))?:/i);
  if (match) {
    const type = match[1].toLowerCase();
    return EMOJI_MAP[type] || '📌';
  }
  return '📌';
}

function parseCommitType(subject) {
  const match = subject.trim().match(/^([a-z]+)(?:\([a-z0-9-_./]+\))?:/i);
  if (match) {
    return match[1].toLowerCase();
  }
  return 'other';
}

function run() {
  try {
    console.log('正在读取 Git 提交记录...');
    // 使用 | 分隔符获取哈希、作者、日期(YYYY-MM-DD)、主题
    // 用 %B 获取完整的 Commit 消息体，并加上特定分隔符
    const logOutput = execSync(
      'git log --pretty=format:"%h|%an|%as|%s" --no-merges',
      { encoding: 'utf8' }
    );

    const lines = logOutput.trim().split('\n').filter(Boolean);
    
    // 统计数据
    const totalCommits = lines.length;
    const authors = new Set();
    const typeCounts = {};
    const commitsByDate = {};

    const formattedCommits = lines.map(line => {
      const [hash, author, date, subject] = line.split('|');
      authors.add(author);

      const type = parseCommitType(subject);
      typeCounts[type] = (typeCounts[type] || 0) + 1;

      if (!commitsByDate[date]) {
        commitsByDate[date] = [];
      }

      const formatted = {
        hash,
        author,
        date,
        subject,
        emoji: getCommitEmoji(subject),
        type
      };

      commitsByDate[date].push(formatted);
      return formatted;
    });

    console.log(`成功读取 ${totalCommits} 条提交记录，正在渲染 Markdown...`);

    // 构建精美的 Markdown 内容
    let md = `# 📊 Git 提交历史更新日志 (Changelog)

> 本文档由自动化脚本 \`scripts/export-git-history.js\` 生成。记录了项目的所有关键演进与功能迭代。

---

## 📈 项目演进看板 (Dashboard)

| 统计指标 | 指标数值 | 备注说明 |
| :--- | :--- | :--- |
| **总提交次数 (Commits)** | \`${totalCommits}\` 次 | 自项目初始化以来的所有非 Merge 提交 |
| **活跃贡献者 (Contributors)** | \`${authors.size}\` 人 | 共同参与项目构建的开发者 |
| **最新更新时间** | \`${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}\` | 导出日志的实时时间 (GMT+8) |

### 🛠️ 提交类别统计 (Commit Breakdown)
${Object.entries(typeCounts)
  .sort((a, b) => b[1] - a[1])
  .map(([type, count]) => {
    const emoji = EMOJI_MAP[type] || '📌';
    const percentage = ((count / totalCommits) * 100).toFixed(1);
    return `- **${emoji} ${type.toUpperCase()}**: \`${count}\` 次 (\`${percentage}%\`)`;
  })
  .join('\n')}

---

## 📅 提交历史明细 (History Timeline)

`;

    // 按照日期倒序排列输出
    const sortedDates = Object.keys(commitsByDate).sort((a, b) => new Date(b) - new Date(a));

    sortedDates.forEach(date => {
      md += `### 📅 ${date}\n\n`;
      commitsByDate[date].forEach(commit => {
        md += `- \`${commit.hash}\` ${commit.emoji} **${commit.subject}** *by ${commit.author}*\n`;
      });
      md += '\n';
    });

    md += `---

## 💡 如何再次生成？

您可以随时在项目根目录下通过以下方式一键更新此文件：
1. **直接运行脚本**：
   \`\`\`bash
   node scripts/export-git-history.js
   \`\`\`
2. **使用 npm 快捷命令**（已集成至 \`package.json\`）：
   \`\`\`bash
   npm run export-git
   \`\`\`
`;

    fs.writeFileSync(OUTPUT_FILE, md, 'utf8');
    console.log(`🎉 恭喜！精美的 Markdown 提交记录已成功导出至：\n👉 ${OUTPUT_FILE}`);
  } catch (error) {
    console.error('导出 Git 记录失败：', error.message);
  }
}

run();
