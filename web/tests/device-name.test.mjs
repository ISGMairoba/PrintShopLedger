import test from 'node:test';
import assert from 'node:assert/strict';
import { deviceName } from '../src/device-name.mjs';

test('devices are named by browser and system', () => {
  assert.equal(
    deviceName(
      'Mozilla/5.0 (Linux; Android 13; SM-A135F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36',
    ),
    'Chrome on Android',
  );
  assert.equal(
    deviceName(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
    ),
    'Safari on iPhone',
  );
  assert.equal(
    deviceName(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36 Edg/129.0',
    ),
    'Edge on Windows',
  );
  assert.equal(deviceName(''), 'Browser on Unknown system');
});
