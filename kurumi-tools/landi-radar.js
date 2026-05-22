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
    // Try multiple browser paths in order of preference
    const browserPaths = [
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
        '/usr/bin/google-chrome',
        '/usr/bin/google-chrome-stable',
        '/snap/bin/chromium'
    ];

    let executablePath = null;
    for (const path of browserPaths) {
        try {
            require('fs').accessSync(path);
            executablePath = path;
            break;
        } catch (e) {
            // Path doesn't exist, try next
        }
    }

    if (!executablePath) {
        console.error('No suitable browser found. Install chromium or google-chrome-stable.');
        process.exit(1);
    }

    const browser = await puppeteer.launch({
        executablePath: executablePath,
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

        // Aggressively remove cookie dialog and overlays
        await page.evaluate(() => {
            document.querySelectorAll('[role="dialog"], [class*="cookie"], [id*="consent"], [class*="consent"], div[style*="position: fixed"]').forEach(el => {
                el.remove();
            });
            document.body.style.overflow = 'auto';
        }).catch(() => {});

        await new Promise(r => setTimeout(r, 1000));

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
