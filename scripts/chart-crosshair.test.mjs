import assert from 'node:assert/strict';
import test from 'node:test';

import {
  crosshairTextInputProps,
  formatCrosshairPrice,
  isUsableCrosshairGeometry,
} from '../src/lib/chartCrosshair.ts';

test('keeps Fabric text and defaultValue in sync for every crosshair price', () => {
  assert.deepEqual(crosshairTextInputProps(7549.5, 2), {
    text: '7,549.50',
    defaultValue: '7,549.50',
  });
});

test('never renders an empty label for transient invalid price data', () => {
  const props = crosshairTextInputProps(Number.NaN, 2);
  assert.equal(props.text, '—');
  assert.equal(props.defaultValue, '—');
  assert.notEqual(props.text, '');
  assert.equal(formatCrosshairPrice(-1234.5678, 3), '-1,234.568');
});

test('accepts only complete finite chart transforms', () => {
  const bounds = { top: 10, bottom: 210, left: 8, right: 300 };
  assert.equal(isUsableCrosshairGeometry(40, bounds, -0.25, 100), true);
  assert.equal(isUsableCrosshairGeometry(0, bounds, -0.25, 100), false);
  assert.equal(isUsableCrosshairGeometry(40, bounds, Number.NaN, 100), false);
  assert.equal(
    isUsableCrosshairGeometry(40, { ...bounds, bottom: bounds.top }, -0.25, 100),
    false,
  );
});
