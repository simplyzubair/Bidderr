import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeJob, humanize, buildPrompts } from '../shared/proposalEngine.js';

const JOB = `Logo vectorization needed - Upwork
I have a hand-drawn logo for my bakery that I need converted to vector for signage.
Please start your proposal with the word "croissant" so I know you read this.
Have you worked on hand-lettering before?
Budget: $50
Skills
Adobe Illustrator
Vector Tracing`;

test('analyzeJob finds hidden instructions, questions, platform, budget, skills', () => {
  const a = analyzeJob(JOB);
  assert.equal(a.platform, 'upwork');
  assert.ok(a.mustFollow.some((m) => m.toLowerCase().includes('croissant')), a.mustFollow.join('|'));
  assert.deepEqual(a.questions, ['Have you worked on hand-lettering before?']);
  assert.match(a.budgetHint, /50/);
  assert.ok(a.skills.includes('Adobe Illustrator'));
});

test('buildPrompts puts must-follow rules and questions into the user prompt', () => {
  const { user, system } = buildPrompts({ jobText: JOB });
  assert.match(user, /croissant/);
  assert.match(user, /Answer this question/);
  assert.match(system, /Never state a price/);
});

test('humanize strips AI tells, markdown and enforces the sign-off', () => {
  const raw = `Here's the proposal:\n\nHello,\n\nI hope this message finds you well. I'm excited to help — I **leverage** Illustrator; it works.\n\n- clean lines\n\nBest regards,\nJohn`;
  const out = humanize(raw, { signOff: 'Cheers,\nKhan', greeting: 'Hello,' });
  assert.ok(!out.includes('—'));
  assert.ok(!out.includes('**'));
  assert.ok(!/finds you well/i.test(out));
  assert.ok(!/Best regards/.test(out));
  assert.ok(out.startsWith('Hello,'));
  assert.ok(out.endsWith('Cheers,\nKhan'));
  assert.match(out, /I use Illustrator\. It works\./);
});

test('humanize does not add greeting when text already greets', () => {
  const out = humanize('Hi Sarah,\n\nSure thing.', { signOff: 'Cheers,\nKhan', greeting: 'Hello,' });
  assert.ok(out.startsWith('Hi Sarah,'));
});
