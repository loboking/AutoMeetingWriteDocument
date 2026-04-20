#!/usr/bin/env node

/**
 * 로컬 Claude API 프록시 서버
 * 터미널에서: node local-server.js
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const http = require('http');

const API_KEY = process.env.ANTHROPIC_API_KEY || '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';

const server = http.createServer(async (req, res) => {
  // CORS 헤더
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  if (req.method === 'POST' && req.url === '/api/claude') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { prompt, system } = JSON.parse(body);

        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': API_KEY,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 4096,
            system: system,
            messages: [{ role: 'user', content: prompt }],
          }),
        });

        const data = await response.json();
        res.writeHead(response.ok ? 200 : 500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
      } catch (error) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: error.message }));
      }
    });
  } else {
    res.writeHead(404);
    res.end('Not Found');
  }
});

const PORT = 3001;
server.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║  🚀 로컬 Claude API 프록시 서버                            ║
║                                                              ║
║  실행 중: http://localhost:${PORT}                      ║
║                                                              ║
║  종료하려면: Ctrl+C                                          ║
╚════════════════════════════════════════════════════════════╝
  `);
});
