const fs = require('fs');
const path = require('path');

function checkFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lucideImports = [...content.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"]lucide-react['"]/g)];
  const importedIcons = new Set();
  lucideImports.forEach(m => {
    m[1].split(',').map(s => s.trim()).filter(Boolean).forEach(icon => importedIcons.add(icon));
  });

  const tags = [...new Set([...content.matchAll(/<([A-Z][a-zA-Z0-9]+)/g)].map(m => m[1]))];
  const missing = [];
  
  tags.forEach(tag => {
    if (!importedIcons.has(tag) && !['React'].includes(tag)) {
      // Check if defined/imported elsewhere in file
      const importRegex = new RegExp(`import\\s+.*\\b${tag}\\b.*\\s+from`, 'g');
      const defRegex = new RegExp(`(?:const|let|var|function|class)\\s+${tag}\\b`, 'g');
      if (!importRegex.test(content) && !defRegex.test(content)) {
        missing.push(tag);
      }
    }
  });

  if (missing.length > 0) {
    console.log(`[${filePath}] Missing:`, missing);
  } else {
    console.log(`[${filePath}] OK`);
  }
}

function scanDir(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      scanDir(fullPath);
    } else if (entry.name.endsWith('.jsx') || entry.name.endsWith('.js')) {
      checkFile(fullPath);
    }
  }
}

scanDir(path.resolve(__dirname, '../../frontend/src'));
