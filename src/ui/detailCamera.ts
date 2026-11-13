import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH, RENDER_SCALE } from '../config';

/**
 * Every scene lays things out in the logical GAME_WIDTH x GAME_HEIGHT view,
 * but the canvas is RENDER_SCALE times larger so detailed art shows every
 * texel. This zooms the scene's main camera to match, with its origin at the
 * top left so screen-fixed UI keeps its coordinates. Phaser's follow, centre,
 * and bounds maths assume a centred origin, so those are corrected here.
 */
export function useDetailCamera(scene: Phaser.Scene): Phaser.Cameras.Scene2D.Camera {
  const camera = scene.cameras.main;
  camera.setOrigin(0, 0).setZoom(RENDER_SCALE);
  const viewW = GAME_WIDTH;
  const viewH = GAME_HEIGHT;

  // Follow puts the target at scroll + followOffset; aim for the middle of the view.
  const startFollow = camera.startFollow.bind(camera);
  camera.startFollow = (target, roundPixels, lerpX, lerpY, offsetX = 0, offsetY = 0) =>
    startFollow(target, roundPixels, lerpX, lerpY, offsetX + viewW / 2, offsetY + viewH / 2);

  camera.clampX = (x: number): number => {
    const b = camera.getBounds();
    return Phaser.Math.Clamp(x, b.x, Math.max(b.x, b.right - viewW));
  };
  camera.clampY = (y: number): number => {
    const b = camera.getBounds();
    return Phaser.Math.Clamp(y, b.y, Math.max(b.y, b.bottom - viewH));
  };
  camera.centerOnX = (x: number) => {
    camera.scrollX = camera.useBounds ? camera.clampX(x - viewW / 2) : x - viewW / 2;
    return camera;
  };
  camera.centerOnY = (y: number) => {
    camera.scrollY = camera.useBounds ? camera.clampY(y - viewH / 2) : y - viewH / 2;
    return camera;
  };
  // Phaser derives the visible world rectangle (used to cull tilemaps) from a centred origin; correct it.
  const preRender = camera.preRender.bind(camera);
  camera.preRender = () => {
    preRender();
    camera.worldView.setTo(camera.scrollX, camera.scrollY, viewW, viewH);
    camera.midPoint.set(camera.scrollX + viewW / 2, camera.scrollY + viewH / 2);
  };
  return camera;
}

/** Text is rasterised at the canvas resolution so it stays sharp under the zoom. */
export function sharpenText(): void {
  const factory = Phaser.GameObjects.GameObjectFactory.prototype as unknown as {
    text: (...args: unknown[]) => Phaser.GameObjects.Text;
  };
  const make = factory.text;
  factory.text = function (this: unknown, ...args: unknown[]) {
    return make.apply(this, args).setResolution(RENDER_SCALE);
  };
}
