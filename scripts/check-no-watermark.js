const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const scanTargets = [
  path.join(rootDir, 'src'),
  path.join(rootDir, 'README.md'),
  path.join(rootDir, 'docs')
];

const textExtensions = new Set([
  '.js',
  '.cjs',
  '.mjs',
  '.ts',
  '.vue',
  '.html',
  '.css',
  '.json',
  '.md'
]);

const blockedPatterns = [
  {
    name: 'watermark DOM marker',
    pattern: /geekez-watermark|__geekezWatermarkBootstrapped__/i
  },
  {
    name: 'watermark injection API',
    pattern: /getWatermarkScript|watermarkInjectScript|saveWatermarkStyle/i
  },
  {
    name: 'watermark setting',
    pattern: /\bwatermarkStyle\b/i,
    allow: /delete\s+nextSettings\.watermarkStyle\s*;/
  },
  {
    name: 'watermark UI or docs text',
    pattern: /Watermark Style|Enhanced Watermark|Top Banner|dynamic watermark|Safe Labeling|环境标识样式|增强水印|顶部横幅|动态水印|安全备注/i
  }
];

function isTextFile(filePath) {
  return textExtensions.has(path.extname(filePath).toLowerCase());
}

function walk(targetPath, files = []) {
  if (!fs.existsSync(targetPath)) return files;

  const stat = fs.statSync(targetPath);
  if (stat.isFile()) {
    if (isTextFile(targetPath)) files.push(targetPath);
    return files;
  }

  if (!stat.isDirectory()) return files;

  for (const entry of fs.readdirSync(targetPath, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'out') continue;
    walk(path.join(targetPath, entry.name), files);
  }

  return files;
}

function relativePath(filePath) {
  return path.relative(rootDir, filePath).replace(/\\/g, '/');
}

const matches = [];

for (const target of scanTargets) {
  for (const filePath of walk(target)) {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split(/\r?\n/);

    lines.forEach((line, index) => {
      for (const rule of blockedPatterns) {
        if (!rule.pattern.test(line)) continue;
        if (rule.allow && rule.allow.test(line)) continue;
        matches.push({
          file: relativePath(filePath),
          line: index + 1,
          rule: rule.name,
          text: line.trim()
        });
      }
    });
  }
}

if (matches.length > 0) {
  console.error('Watermark code or copy was found. Remove it before building.');
  for (const match of matches) {
    console.error(`- ${match.file}:${match.line} [${match.rule}] ${match.text}`);
  }
  process.exit(1);
}

console.log('No watermark code or copy found.');
