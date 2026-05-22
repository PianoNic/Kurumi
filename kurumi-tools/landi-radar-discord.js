#!/usr/bin/env node
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const REGION = process.argv[2] || 'Baden';
const SNAPSHOTS = parseInt(process.argv[3]) || 3; // Number of timeline snapshots
const INTERVAL = 10000; // 10 seconds between captures (for demo; real radar updates every 10min)

(async () => {
    const browser = await puppeteer.launch({
        executablePath: '/usr/bin/chromium',
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    try {
        const page = await browser.newPage();
        await page.setViewport({ width: 1024, height: 576 });

        await page.goto('https://www.landi.ch/wetter/niederschlagsradar', {
            waitUntil: 'networkidle2',
            timeout: 15000
        });

        // Force-remove cookie dialog and overlays from DOM
        await page.evaluate(() => {
            // Remove dialog containers
            document.querySelectorAll('[role="dialog"], [class*="cookie"], [id*="consent"], [class*="consent"]').forEach(el => {
                if (el.parentNode) el.parentNode.removeChild(el);
            });
            // Remove backdrop overlays
            document.querySelectorAll('div[style*="position: fixed"]').forEach(el => {
                if (el.textContent.toLowerCase().includes('cookie')) {
                    if (el.parentNode) el.parentNode.removeChild(el);
                }
            });
        }).catch(() => {});

        await new Promise(r => setTimeout(r, 2000));

        const images = [];

        for (let i = 0; i < SNAPSHOTS; i++) {
            const filename = `/tmp/landi-radar-${REGION}-${i}.png`;
            await page.screenshot({ path: filename, fullPage: false });
            images.push(filename);

            if (i < SNAPSHOTS - 1) {
                process.stdout.write(`Captured snapshot ${i + 1}/${SNAPSHOTS}...\n`);
                await page.reload({ waitUntil: 'networkidle2' }).catch(() => {});
                // Dismiss dialog again after reload
                await page.evaluate(() => {
                    document.querySelectorAll('[role="dialog"], [class*="cookie"], [id*="consent"], [class*="consent"]').forEach(el => {
                        if (el.parentNode) el.parentNode.removeChild(el);
                    });
                }).catch(() => {});
                await new Promise(r => setTimeout(r, INTERVAL));
            }
        }

        // Output image paths for Discord upload
        console.log(JSON.stringify({
            region: REGION,
            timestamp: new Date().toLocaleString('de-CH'),
            images: images,
            count: SNAPSHOTS
        }));

    } catch (error) {
        console.error('Error:', error.message);
        process.exit(1);
    } finally {
        await browser.close();
    }
})();
