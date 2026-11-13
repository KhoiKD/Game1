import { expect, test, type Page } from '@playwright/test';

/** The running game, through the debug handle in main.ts. */
async function activeScenes(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const game = (window as unknown as { __tamerunner: { scene: { getScenes(active: boolean): Array<{ scene: { key: string } }> } } }).__tamerunner;
    return game.scene.getScenes(true).map((s) => s.scene.key);
  });
}

async function waitForScene(page: Page, key: string): Promise<void> {
  await expect.poll(() => activeScenes(page), { timeout: 20_000 }).toContain(key);
}

function level<T>(page: Page, read: string): Promise<T> {
  return page.evaluate((code) => {
    const game = (window as unknown as { __tamerunner: { scene: { getScene(key: string): unknown } } }).__tamerunner;
    return new Function('s', `return ${code}`)(game.scene.getScene('Level')) as T;
  }, read);
}

test('boots, starts a stage, moves, and fires', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await waitForScene(page, 'Title');

  await page.mouse.click(480, 300);
  await waitForScene(page, 'ClassSelect');
  await page.keyboard.press('Digit2');
  await waitForScene(page, 'Hub');
  await page.keyboard.press('Digit1');
  await waitForScene(page, 'Level');
  await page.waitForTimeout(1000);

  // Nothing should hurt the player during the test.
  await level(page, '(s.health = { ...s.health, invulnerableUntil: 1e12 }, true)');

  const startX = await level<number>(page, 's.player.x');
  await page.keyboard.down('KeyD');
  await page.waitForTimeout(1200);
  await page.keyboard.up('KeyD');
  expect(await level<number>(page, 's.player.x')).toBeGreaterThan(startX + 100);

  const ammoBefore = await level<number>(page, 's.weaponStates[s.weaponIndex].ammo');
  await page.mouse.move(800, 300);
  await page.mouse.down();
  await page.waitForTimeout(400);
  await page.mouse.up();
  expect(await level<number>(page, 's.weaponStates[s.weaponIndex].ammo')).toBeLessThan(ammoBefore);

  expect(errors).toEqual([]);
});
