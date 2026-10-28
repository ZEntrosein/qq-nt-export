import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm, access } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const python = process.env.QCE_PYTHON || join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const browserPath = process.env.QCE_BROWSER_PATH || (process.platform === 'win32' ? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' : '/usr/bin/chromium');
await mkdir(join(root, 'test-output'), {recursive:true});
const directory = await mkdtemp(join(root, 'test-output', 'browser-'));
const generated = spawnSync(python, [join(root, 'tests/make_demo.py'), directory], {encoding:'utf8'});
assert.equal(generated.status, 0, generated.stdout + generated.stderr);
const fixture = JSON.parse(generated.stdout.trim());
const browser = await chromium.launch({executablePath:browserPath, headless:true, args:['--disable-gpu','--disable-background-networking']});
const errors = [], network = [];
let checks = 0;
const check = (value, message) => {assert.ok(value, message); checks++;};
try {
  const context = await browser.newContext({locale:'zh-CN', timezoneId:'Asia/Shanghai', viewport:{width:1440,height:1000}});
  await context.route(/^https?:\/\//, route => {network.push(route.request().url()); return route.abort();});
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(pathToFileURL(fixture.small.html).href);
  await page.waitForFunction(() => document.querySelector('#info-total')?.textContent === '8 / 8').catch(async error => {
    console.log(JSON.stringify({errors, network, total:await page.locator('#info-total').textContent().catch(()=>null),
      body:(await page.locator('body').innerText()).slice(0,700)}));
    throw error;
  });
  check(await page.locator('.message').count() === 7, 'Export uses the original QCE message layout');
  const image = page.locator('.message img[src*="resources/images/"]').first();
  check(await image.evaluate(element => element.complete && element.naturalWidth > 0), 'Local image file decodes');
  await page.locator('#themeToggle').click();
  check(await page.evaluate(() => document.documentElement.getAttribute('data-theme') === 'dark' || document.body.getAttribute('data-theme') === 'dark'), 'Original theme switch works');
  const quote = page.locator('.reply-content[data-reply-to]').first();
  check(await quote.getAttribute('data-reply-to') === 'msg-9007199254740993123', 'Large quote ID is lossless in the browser');
  await quote.click();
  check(await page.locator('[id="msg-9007199254740993123"]').count() === 1, 'Quoted source message exists');
  const forward = page.locator('details.forward-card-expandable').first();
  await forward.locator('> summary').click();
  await forward.locator('details > summary').first().click();
  check(await forward.locator('video').count() >= 1, 'Deep forwarded video renders as a video element');
  if (fixture.realVideo) {
    const video = forward.locator('video').first();
    await video.evaluate(element => {element.preload='auto'; element.load();});
    await page.waitForFunction(() => [...document.querySelectorAll('details video')].some(video => video.readyState >= 1));
    check(await video.evaluate(element => element.videoWidth === 64), 'Deep forwarded video file plays/loads metadata');
    check(await video.evaluate(async element => {await element.play(); const playing=!element.paused; element.pause(); return playing;}), 'Deep forwarded video actually plays');
  }
  check(await page.locator('.reply-content-video').count() === 1, 'Quote-only video renders as a player');
  check(await page.locator('.export-media-failure').count() >= 2, 'Missing media retains visible markers');
  check(await page.locator('.system-message-container').innerText().then(text => text.includes('@其他成员')), 'System mention text remains visible');
  check(network.length === 0, 'Generated HTML makes no remote resource requests');
  const nestedTarget = await forward.locator('.forward-message-item[id]').last().getAttribute('id');
  await forward.locator('> summary').click();
  await page.evaluate(id => window.scrollToMessage(id), nestedTarget);
  check(await page.locator('[id="' + nestedTarget + '"]').isVisible(), 'Quote navigation opens the parent cards of a nested target');

  // Untrusted chat titles cannot terminate the metadata comment and inject HTML.
  const unsafe = JSON.parse(await readFile(fixture.small.json, 'utf8'));
  unsafe.chatInfo.name = '--><script>window.__titleExecuted=1</script><img src=x onerror="window.__titleExecuted=2">';
  unsafe.messages[0].content.elements.unshift({type:'text',data:{text:'<img src=x onerror="window.__searchExecuted=1"> xssToken'}});
  const unsafeJson = join(directory, 'unsafe.json'), unsafeHtml = join(directory, 'unsafe.html');
  await writeFile(unsafeJson, JSON.stringify(unsafe));
  const render = spawnSync(process.execPath, [join(root, 'tools/render-qce.mjs'), unsafeJson, unsafeHtml], {encoding:'utf8'});
  assert.equal(render.status, 0, render.stderr);
  await page.goto(pathToFileURL(unsafeHtml).href);
  check(await page.evaluate(() => window.__titleExecuted === undefined), 'Metadata title remains inert');
  await page.locator('#searchBtn').click();
  await page.locator('#searchInput').fill('xssToken');
  await page.waitForTimeout(450);
  check(await page.evaluate(() => window.__searchExecuted === undefined), 'Search highlighting preserves escaped chat text');

  await page.goto(pathToFileURL(fixture.large.html).href);
  await page.waitForFunction(() => document.querySelectorAll('.message-block').length < 1218);
  check(await page.locator('.message-block').count() < 1218, 'Original dynamic-height virtual scrolling activates');
  await page.locator('#searchBtn').click();
  await page.locator('#searchInput').fill('聊天记录');
  await page.waitForTimeout(500);
  const largeForward = page.locator('details.forward-card-expandable').first();
  await largeForward.locator('> summary').click();
  await largeForward.locator('details > summary').first().click();
  await page.waitForTimeout(500);
  check(await largeForward.evaluate(element => element.open), 'Forward card expands after filtering');
  const expandedPosition = await largeForward.evaluate(element => {
    const block=element.closest('.message-block'), next=block.nextElementSibling;
    return next && next.classList.contains('message-block') ? {height:block.getBoundingClientRect().height,
      nextTop:next.getBoundingClientRect().top + window.scrollY, bottom:block.getBoundingClientRect().bottom + window.scrollY} : null;
  });
  check(expandedPosition !== null, 'Height regression check includes a following filtered message');
  check(expandedPosition.nextTop >= expandedPosition.bottom - 2, 'Expanded forward does not overlap the next message');
  await largeForward.locator('> summary').click();
  await page.waitForTimeout(400);
  check(!(await largeForward.evaluate(element => element.open)), 'Forward card collapses normally');
  const collapsedPosition = await largeForward.evaluate(element => {
    const block=element.closest('.message-block'), next=block.nextElementSibling;
    return {height:block.getBoundingClientRect().height, nextTop:next.getBoundingClientRect().top + window.scrollY};
  });
  check(expandedPosition.height > collapsedPosition.height + 50 &&
    Math.abs((expandedPosition.nextTop - collapsedPosition.nextTop) - (expandedPosition.height - collapsedPosition.height)) < 3,
    'Collapsing the card moves the following message back by the actual height difference');

  if (process.env.QCE_READER_PATH) {
    await access(process.env.QCE_READER_PATH);
    await page.goto(pathToFileURL(process.env.QCE_READER_PATH).href);
    await page.locator('#exportInput').setInputFiles(fixture.small.folder);
    await page.waitForFunction(() => document.querySelectorAll('.message').length >= 7);
    check(await page.locator('.message img').count() > 0, 'Existing reader accepts the QCE JSON and resource directory');
    const importedVideo = page.locator('video').first();
    check(await importedVideo.count() === 1, 'Existing reader identifies video media');
    if (fixture.realVideo) {
      const quotedVideo = page.locator('.reply-content video').first();
      await quotedVideo.scrollIntoViewIfNeeded();
      check(await quotedVideo.evaluate(async element => {await element.play(); const playing=!element.paused; element.pause(); return playing;}), 'Existing reader plays the quote-only video from the directory');
    }
    await page.reload();
    // The same reader can open the complete ZIP directly, excluding media-report.json.
    const zipInput = page.locator('input[type=file][accept*=".zip"]').first();
    await zipInput.setInputFiles(fixture.small.zip);
    await page.waitForFunction(() => document.querySelectorAll('.message').length >= 7);
    check(await page.locator('.message').count() >= 7, 'Existing reader opens the ZIP directly');
    if (fixture.realVideo) {
      const quotedVideo = page.locator('.reply-content video').first();
      await quotedVideo.scrollIntoViewIfNeeded();
      check(await quotedVideo.evaluate(async element => {await element.play(); const playing=!element.paused; element.pause(); return playing;}), 'Existing reader plays the quote-only video directly from the ZIP');
    }
  } else console.log('QCE_READER_PATH unset: external reader integration checks omitted');
  check(errors.length === 0, 'No browser script errors: ' + errors.join('; '));
  console.log(`Browser checks passed: ${checks}; real video fixture: ${fixture.realVideo}`);
} finally {
  await browser.close();
  await rm(directory, {recursive:true, force:true});
}
