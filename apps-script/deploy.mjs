import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function deploy() {
  try {
    console.log('🚀 Starting Google Apps Script deployment...');

    // 1. Read .clasp.json for scriptId
    const claspConfig = JSON.parse(fs.readFileSync(path.join(__dirname, '.clasp.json'), 'utf8'));
    const scriptId = claspConfig.scriptId;
    console.log(`📋 Target Script ID: ${scriptId}`);

    // 2. Read clasp credentials
    let credsRaw = process.env.CLASPRC_JSON;
    if (!credsRaw) {
      const homeClasprc = path.join(process.env.USERPROFILE || process.env.HOME || '', '.clasprc.json');
      if (fs.existsSync(homeClasprc)) {
        credsRaw = fs.readFileSync(homeClasprc, 'utf8');
      }
    }

    if (!credsRaw) {
      throw new Error('No CLASPRC_JSON secret or ~/.clasprc.json found!');
    }

    const clasprc = JSON.parse(credsRaw);
    const creds = clasprc.tokens?.default || clasprc;

    if (!creds.refresh_token) {
      throw new Error('No refresh_token found in clasp credentials!');
    }

    // 3. Obtain fresh access_token using refresh_token
    console.log('🔑 Refreshing Google OAuth access token...');
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: creds.client_id,
        client_secret: creds.client_secret,
        refresh_token: creds.refresh_token,
        grant_type: 'refresh_token'
      })
    });

    const tokenData = await tokenRes.json();
    if (!tokenRes.ok || !tokenData.access_token) {
      throw new Error(`Failed to refresh token: ${JSON.stringify(tokenData)}`);
    }
    console.log('✅ OAuth access token acquired successfully!');

    // 4. Read project files
    const manifestContent = fs.readFileSync(path.join(__dirname, 'appsscript.json'), 'utf8');
    const codeContent = fs.readFileSync(path.join(__dirname, 'Code.js'), 'utf8');

    const files = [
      {
        name: 'appsscript',
        type: 'JSON',
        source: manifestContent
      },
      {
        name: '程式碼',
        type: 'SERVER_JS',
        source: codeContent
      }
    ];

    console.log(`📦 Prepared ${files.length} files (appsscript.json, Code.js)`);
    console.log('⏳ Uploading to Apps Script API...');

    // 5. Update content on Google Apps Script
    const updateRes = await fetch(`https://script.googleapis.com/v1/projects/${scriptId}/content`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${tokenData.access_token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ files })
    });

    const updateData = await updateRes.json();
    if (!updateRes.ok) {
      throw new Error(`Apps Script API Error: ${JSON.stringify(updateData, null, 2)}`);
    }

    console.log('🎉 Successfully deployed to Google Apps Script!');
    console.log(`📊 Remote project now has ${updateData.files?.length || 0} files.`);
  } catch (err) {
    console.error('❌ Deployment failed:', err.message || err);
    process.exit(1);
  }
}

deploy();
