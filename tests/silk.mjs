import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { encode } from '../vendor/silk-wasm/lib/index.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
await mkdir(join(root, 'test-output'), {recursive:true});
const directory = await mkdtemp(join(root, 'test-output', 'silk-'));
try {
  const pcm = Buffer.alloc(24000 * 2);
  for (let index = 0; index < 24000; index++) pcm.writeInt16LE(Math.round(Math.sin(index * 440 * 2 * Math.PI / 24000) * 4000), index * 2);
  const encoded = await encode(pcm, 24000);
  const source = join(directory, '演示语音.silk'), target = join(directory, '演示语音.wav');
  await writeFile(source, encoded.data);
  const result = spawnSync(process.execPath, [join(root, 'tools/decode-silk.mjs'), source, target], {encoding:'utf8'});
  assert.equal(result.status, 0, result.stderr);
  const wave = await readFile(target);
  assert.equal(wave.toString('ascii', 0, 4), 'RIFF');
  assert.equal(wave.toString('ascii', 8, 12), 'WAVE');
  assert.equal(wave.readUInt32LE(24), 24000);
  assert.ok(wave.length > 40000);
  console.log('SILK encode -> bundled decoder -> playable WAV: passed');
} finally { await rm(directory, {recursive:true, force:true}); }
