#!/usr/bin/env node
'use strict';
// Git merge driver for core-plugin-data/flashcards/flashcards.json, so ratings
// made on two devices are combined instead of one file replacing the other.
// Usage (git config merge.flashcards.driver): git-merge-flashcards.cjs %O %A %B
// Writes the result to %A. Exits 1 on unreadable input, leaving a normal conflict.
const fs = require('node:fs');
const { merge, valid } = require('../src/merge.cjs');

function read(file, optional) {
  const text = fs.readFileSync(file, 'utf8');
  if (optional && !text.trim()) return null; // no common ancestor
  const state = JSON.parse(text);
  if (!valid(state)) throw new Error(`${file} is not a supported flashcards.json`);
  return state;
}
try {
  const [base, ours, theirs] = process.argv.slice(2);
  if (!theirs) throw new Error('expected %O %A %B');
  fs.writeFileSync(ours, JSON.stringify(merge(read(base, true), read(ours), read(theirs))));
} catch (error) {
  console.error(`flashcards merge driver: ${error.message}`);
  process.exit(1);
}
