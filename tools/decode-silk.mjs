// Uses the same portable MIT-licensed silk-wasm runtime as the original plugin.
import { readFile, writeFile } from 'node:fs/promises';
import { decode, isSilk } from '../vendor/silk-wasm/lib/index.mjs';
const [source, destination] = process.argv.slice(2);
if (!source || !destination) throw new Error('Usage: node tools/decode-silk.mjs input.silk output.wav');
const input = await readFile(source);
if (!isSilk(input)) throw new Error('Not a QQ SILK stream');
const sampleRate = 24000;
const {data} = await decode(input, sampleRate);
if (!data.length) throw new Error('SILK decoded to empty audio');
const wav = Buffer.alloc(44 + data.length);
wav.write('RIFF', 0); wav.writeUInt32LE(36 + data.length, 4); wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(sampleRate, 24); wav.writeUInt32LE(sampleRate * 2, 28);
wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(data.length, 40);
wav.set(data, 44); await writeFile(destination, wav);
