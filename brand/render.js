// Renders the brand images: node brand/render.js
const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const b = await chromium.launch();
  for (const [name, w, h] of [['avatar', 1000, 1000], ['banner', 1500, 500]]) {
    const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    await p.goto('file://' + path.join(__dirname, name + '.html'));
    await p.evaluate(() => document.fonts.ready);
    await p.waitForTimeout(500);
    await p.screenshot({ path: path.join(__dirname, `x-${name}.png`) });
  }
  await b.close();
})();
