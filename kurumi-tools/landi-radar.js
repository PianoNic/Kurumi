#!/usr/bin/env node
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const REGION = process.argv[2] || 'Baden';
const CACHE_DIR = '/tmp';
const CACHE_FILE = path.join(CACHE_DIR, `landi-radar-${REGION}.cache`);
const IMAGE_FILE = path.join(CACHE_DIR, `landi-radar-${REGION}.png`);
const CACHE_MAX_AGE = 300; // 5 minutes

// Check if cache is fresh
if (fs.existsSync(CACHE_FILE)) {
    const stats = fs.statSync(CACHE_FILE);
    const age = Math.floor((Date.now() - stats.mtimeMs) / 1000);
    if (age < CACHE_MAX_AGE) {
        console.log(fs.readFileSync(CACHE_FILE, 'utf-8'));
        process.exit(0);
    }
}

(async () => {
    const browser = await puppeteer.launch({
        executablePath: '/usr/bin/chromium',
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    try {
        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 720 });

        // Fetch radar page
        console.log('Fetching live radar data...');
        await page.goto('https://www.landi.ch/wetter/niederschlagsradar', {
            waitUntil: 'networkidle2',
            timeout: 15000
        });

        // Wait for radar to load
        await page.waitForSelector('[data-testid="radar-container"], .radar, iframe', {
            timeout: 10000
        }).catch(() => {
            console.warn('Radar container not found, proceeding anyway');
        });

        // Capture screenshot
        await page.screenshot({ path: IMAGE_FILE, fullPage: false });

        // Extract some radar info if available
        const radarInfo = await page.evaluate(() => {
            const text = document.body.innerText;
            const lines = text.split('\n').filter(l => l.trim().length > 0);
            return lines.slice(0, 20).join('\n');
        }).catch(() => 'Live radar rendered.');

        const timestamp = new Date().toLocaleString('de-CH');
        const output = `🌧️ LANDI Weather Radar — ${REGION}\n` +
                       `${'='.repeat(40)}\n\n` +
                       `📊 Live Radar (captured ${timestamp}):\n` +
                       `   Screenshot: ${IMAGE_FILE}\n\n` +
                       `🔗 Full page: https://www.landi.ch/wetter/niederschlagsradar\n` +
                       `📍 Forecast: https://www.landi.ch/wetter/lokalprognose/${REGION}\n\n` +
                       `💾 (cached for 5min)`;

        console.log(output);
        fs.writeFileSync(CACHE_FILE, output);

    } catch (error) {
        console.error('Error fetching radar:', error.message);
        process.exit(1);
    } finally {
        await browser.close();
    }
})();
