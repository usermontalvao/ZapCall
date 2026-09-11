import test from 'node:test';
import assert from 'node:assert/strict';
import { configurarMidia } from '../src/media-config.mjs';

test('perfil de video padrao prioriza latencia e limita o custo da VPS', () => {
  const c = configurarMidia({});
  assert.deepEqual(
    { profile: c.profile, width: c.width, height: c.height, frameRate: c.frameRate, bitrate: c.bitrate },
    { profile: 'realtime', width: 640, height: 360, frameRate: 24, bitrate: 650_000 },
  );
  assert.ok(c.browserQueueBytes < 64 * 1024);
  assert.ok(c.decoderQueueSize <= 2);
});

test('perfil e overrides de video sao normalizados e mantem dimensoes pares', () => {
  const hd = configurarMidia({ ZAPCALL_VIDEO_PROFILE: 'hd' });
  assert.equal(hd.width, 1280); assert.equal(hd.height, 720); assert.equal(hd.frameRate, 30);

  const custom = configurarMidia({
    ZAPCALL_VIDEO_PROFILE: 'balanced',
    ZAPCALL_VIDEO_WIDTH: '1001',
    ZAPCALL_VIDEO_HEIGHT: '541',
    ZAPCALL_VIDEO_FPS: '99',
    ZAPCALL_VIDEO_BITRATE: '10',
  });
  assert.equal(custom.width, 1000);
  assert.equal(custom.height, 540);
  assert.equal(custom.frameRate, 30);
  assert.equal(custom.bitrate, 150_000);
});

test('perfil desconhecido cai no realtime em vez de liberar 720p sem querer', () => {
  assert.equal(configurarMidia({ ZAPCALL_VIDEO_PROFILE: 'cinema' }).profile, 'realtime');
});
