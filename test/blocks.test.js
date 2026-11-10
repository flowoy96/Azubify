const test = require('node:test');
const assert = require('node:assert');
const B = require('../server/blocks');

test('sanitizeBlocks entfernt Skripte und prüft Bilder', () => {
  const [a, b] = B.sanitizeBlocks([{ type: 'text', html: '<b>x</b><script>alert(1)</script><img src=x onerror=1>' }, { type: 'image', src: 'http://evil/x.png' }]);
  assert.strictEqual(a.html, '<b>x</b>');
  assert.strictEqual(b.src, '');
});
test('stripSolutions verrät keine Lösungen', () => {
  const blocks = B.sanitizeBlocks([{ type: 'single', options: ['a', 'b'], correct: 1 }, { type: 'cloze', text: 'A [[geheim]]' }, { type: 'short', solution: ['x'] }]);
  const s = JSON.stringify(B.stripSolutions(blocks));
  assert.ok(!s.includes('geheim') && !s.includes('"correct"') && !s.includes('"solution"'));
});
test('Auto-Bewertung', () => {
  const blocks = B.sanitizeBlocks([
    { type: 'single', options: ['a', 'b'], correct: 1, points: 2 },
    { type: 'multi', options: ['a', 'b', 'c'], correct: [0, 1], points: 2 },
    { type: 'number', solution: 3.5, tolerance: 0.1, points: 1 },
    { type: 'cloze', text: '[[a]] [[b|c]]', points: 2 },
    { type: 'long', points: 3 },
  ]);
  const ans = { [blocks[0].id]: 1, [blocks[1].id]: [0, 2], [blocks[2].id]: '3,55', [blocks[3].id]: ['A', 'x'] };
  const r = B.evaluate(blocks, ans, {});
  assert.strictEqual(r.perBlock[blocks[0].id].awarded, 2);
  assert.strictEqual(r.perBlock[blocks[1].id].awarded, 0);
  assert.strictEqual(r.perBlock[blocks[2].id].awarded, 1);
  assert.strictEqual(r.perBlock[blocks[3].id].awarded, 1);
  assert.strictEqual(r.open, 1);
  assert.strictEqual(r.max, 10);
});
