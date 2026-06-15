// pm2 ecosystem for n8n — runs n8n with the API keys loaded from .env so the
// workflows' $env.* expressions resolve. No secrets live in this file; it reads
// them from .env at launch. Start with:  pm2 start ecosystem.config.js  &&  pm2 save
const fs = require('fs');
const path = require('path');

const env = { N8N_BLOCK_ENV_ACCESS_IN_NODE: 'false' };
const envFile = path.join(__dirname, '.env');
for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/\s+#.*$/, '').trim();
}

module.exports = {
  apps: [{
    name: 'n8n',
    script: path.join(process.env.APPDATA || (process.env.USERPROFILE + '\\AppData\\Roaming'), 'npm', 'node_modules', 'n8n', 'bin', 'n8n'),
    args: 'start',
    interpreter: 'node',
    autorestart: true,
    max_restarts: 10,
    env,
  }],
};
