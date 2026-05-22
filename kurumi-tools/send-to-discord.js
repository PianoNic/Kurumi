#!/usr/bin/env node
const fs = require('fs');
const FormData = require('form-data');
const https = require('https');

const guildId = process.argv[2];
const channelId = process.argv[3];
const imagePaths = process.argv.slice(4);

if (!guildId || !channelId || imagePaths.length === 0) {
    console.error('Usage: send-to-discord.js <guildId> <channelId> <image1> <image2> ...');
    process.exit(1);
}

const token = process.env.DISCORD_TOKEN;
if (!token) {
    console.error('DISCORD_TOKEN not set');
    process.exit(1);
}

async function uploadImage(imagePath, index, total) {
    return new Promise((resolve, reject) => {
        const form = new FormData();
        form.append('file', fs.createReadStream(imagePath));

        const content = `🌧️ LANDI Radar — Baden (${index}/${total}) — ${new Date().toLocaleTimeString('de-CH')}`;
        form.append('payload_json', JSON.stringify({ content }));

        const options = {
            hostname: 'discord.com',
            port: 443,
            path: `/api/v10/channels/${channelId}/messages`,
            method: 'POST',
            headers: {
                'Authorization': `Bot ${token}`,
                ...form.getHeaders()
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode === 200) {
                    resolve();
                } else {
                    reject(new Error(`Status ${res.statusCode}: ${data}`));
                }
            });
        });

        req.on('error', reject);
        form.pipe(req);
    });
}

(async () => {
    try {
        for (let i = 0; i < imagePaths.length; i++) {
            await uploadImage(imagePaths[i], i + 1, imagePaths.length);
            console.log(`Uploaded ${i + 1}/${imagePaths.length}`);
        }
        console.log('Done.');
    } catch (error) {
        console.error('Error:', error.message);
        process.exit(1);
    }
})();
