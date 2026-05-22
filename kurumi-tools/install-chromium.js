const puppeteer = require('puppeteer');
const path = require('path');
const os = require('os');

(async () => {
  try {
    // Force download to our persistent cache
    process.env.PUPPETEER_CACHE_DIR = '/kurumi-tools/puppeteer-cache';
    
    console.log('Downloading Chromium...');
    const browserFetcher = puppeteer.createBrowserFetcher({
      path: '/kurumi-tools/puppeteer-cache'
    });
    
    const revisionInfo = await browserFetcher.download('1262107');
    console.log('✓ Chromium downloaded to:', revisionInfo.executablePath);
    
  } catch (error) {
    console.error('Download failed:', error.message);
    process.exit(1);
  }
})();
