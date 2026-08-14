const assert = require('node:assert/strict')
const { chromium } = require('playwright')

const url = process.env.DSH_TERMINAL_SMOKE_URL || 'http://127.0.0.1:3091'
const marker = `DSH_BROWSER_TERMINAL_OK_${process.pid}`

;(async () => {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1500, height: 900 } })
  const faults = []
  page.on('pageerror', error => faults.push(error.message))
  page.on('console', message => { if (message.type() === 'error') faults.push(message.text()) })
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded' })
    const continueButton = page.getByRole('button', { name: '继续', exact: true })
    await continueButton.waitFor({ timeout: 10_000 }).catch(() => {})
    if (await continueButton.isVisible().catch(() => false)) await continueButton.click()
    const laterButton = page.getByRole('button', { name: '稍后配置', exact: true })
    await laterButton.waitFor({ timeout: 10_000 }).catch(() => {})
    if (await laterButton.isVisible().catch(() => false)) await laterButton.click()
    await page.getByRole('button', { name: '终端' }).first().waitFor({ timeout: 30_000 })
    await page.getByRole('button', { name: '终端' }).first().click()
    await page.locator('.uking-dock[data-open="true"]').waitFor()
    await page.getByRole('button', { name: /PowerShell|Shell/ }).click()
    const active = page.locator('.uking-terminal:not([hidden])')
    await active.locator('.xterm-helper-textarea').waitFor()
    await active.locator('.xterm-helper-textarea').focus()
    const command = process.platform === 'win32' ? `Write-Output '${marker}'` : `printf '${marker}\\n'`
    await page.keyboard.type(command)
    await page.keyboard.press('Enter')
    await page.waitForFunction(expected => document.querySelector('.uking-terminal:not([hidden]) .xterm-rows')?.textContent?.includes(expected), marker)

    await page.getByRole('button', { name: /PowerShell|Shell/ }).click()
    assert.equal(await page.locator('.uking-tab').count(), 2, 'second terminal tab did not open')
    assert.match(await page.locator('.uking-foot a').getAttribute('href'), /^https:\/\/www\.u-king\.org\//)
    assert.deepEqual(faults, [], `browser errors: ${faults.join(' | ')}`)
    if (process.env.DSH_TERMINAL_SCREENSHOT) {
      await page.screenshot({ path: process.env.DSH_TERMINAL_SCREENSHOT, fullPage: true })
    }
    console.log('BROWSER_SMOKE_OK')
  } catch (error) {
    console.error(`BROWSER_FAULTS: ${faults.join(' | ')}`)
    console.error(`BODY_TEXT: ${(await page.locator('body').innerText().catch(() => '')).slice(0, 1200)}`)
    throw error
  } finally {
    await browser.close()
  }
})().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
