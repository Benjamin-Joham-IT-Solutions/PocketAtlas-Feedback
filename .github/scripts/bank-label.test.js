// node --test .github/scripts/bank-label.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { detectBank, isFormatRequest } = require('./bank-label.js');

// what the app sends (src/data/core/formatReport.ts in PocketAtlas): structure only
const report = (bank, more = '') => `### Bank
- Bank: ${bank}

### File
- Type: CSV / text (.csv), 2 KB, UTF-8
- Name pattern: \`Aaaaaaa_AA99999999.csv\`
- App version: 1.6.0

### What Pocket Atlas made of it
${more}
_Sent from Pocket Atlas: only the structure above, no names, IBANs or amounts._`;

test('the typed bank wins, known names come out canonical', () => {
  assert.deepEqual(detectBank('Bank statement format: zkb · CSV', report('zkb')), { name: 'Zürcher Kantonalbank', source: 'typed' });
  assert.deepEqual(detectBank('x', report('Post Finance')), { name: 'PostFinance', source: 'typed' });
  assert.deepEqual(detectBank('x', report('Migros Bank, Schweiz')), { name: 'Migros Bank', source: 'typed' });
  // unknown banks keep the typed name, tidied
  assert.deepEqual(detectBank('x', report('Alpen  Privatbank **AG**')), { name: 'Alpen Privatbank AG', source: 'typed' });
  // the template's line
  assert.deepEqual(detectBank('Bank statement format: ', '### Bank\n- Bank: Hypo Tirol\n- Country: AT'), { name: 'Hypo', source: 'typed' });
});

test('no bank typed: the recognised profile, a name, then a layout', () => {
  assert.deepEqual(detectBank('Bank statement format: PDF (Migros Bank (PDF))', report('not given', "- Format: pdf, profile `ch.migros-pdf`")), { name: 'Migros Bank', source: 'profile' });
  assert.deepEqual(detectBank('Bank statement format: Revolut export', report('not given')), { name: 'Revolut', source: 'text' });
  const revolut = report('not given', '### Table\n```\nType | Product | Started Date | Completed Date | Description | Amount | Fee | Currency | State | Balance\nAAAA | Aaaaaaa | 9999-99-99\n```');
  assert.deepEqual(detectBank('Bank statement format: CSV / text', revolut), { name: 'Revolut', source: 'layout' });
  const volksbank = report('not given', '```\n700 | 60–150:Alter Saldo per 99.99.9999\n680 | 60–90:Datum  110–200:Buchungstext  380–400:Wert  460–500:Betrag\n```');
  assert.deepEqual(detectBank('Bank statement format: PDF', volksbank), { name: 'Volksbank', source: 'layout' });
});

test('nothing to go on: null; words inside other words do not count', () => {
  assert.equal(detectBank('Bank statement format: CSV / text', report('not given')), null);
  assert.equal(detectBank('Bank statement format: PDF', report('', 'otherwise thinking of the ubsolete layout')), null);
  assert.equal(detectBank('Bank statement format: ', '### Bank\n- Bank:\n- Country:\n'), null);
});

test('only bank statement format requests are handled', () => {
  assert.ok(isFormatRequest('Bank statement format: PDF', ''));
  assert.ok(isFormatRequest('Something', report('UBS')));
  assert.ok(!isFormatRequest('The app crashes on start', 'Steps: open the app'));
});

// a fake Octokit: labels in the repo, labels on the issue, comments
function fakeGithub(repoLabels = [], issueLabels = [], comments = []) {
  const s = { repoLabels: new Set(repoLabels), issueLabels: new Set(issueLabels), comments: [...comments] };
  const notFound = () => Object.assign(new Error('Not Found'), { status: 404 });
  const rest = {
    issues: {
      getLabel: async ({ name }) => {
        if (!s.repoLabels.has(name)) throw notFound();
      },
      createLabel: async ({ name }) => void s.repoLabels.add(name),
      addLabels: async ({ labels }) => {
        for (const l of labels) {
          assert.ok(s.repoLabels.has(l), `label ${l} created first`);
          s.issueLabels.add(l);
        }
      },
      removeLabel: async ({ name }) => {
        if (!s.issueLabels.delete(name)) throw notFound();
      },
      listComments: async () => ({ data: s.comments }),
      createComment: async ({ body }) => void s.comments.push({ body }),
    },
  };
  return { s, github: { rest, paginate: async (fn, args) => (await fn(args)).data } };
}
const ctx = (action, title, body, labels = []) => ({ payload: { action, issue: { number: 7, title, body, labels: labels.map((name) => ({ name })) } }, repo: { owner: 'o', repo: 'r' } });
const core = { info() {} };
const run = require('./bank-label.js');

test('run: a new request gets "new" and its bank; an unnamed one is asked once, then follows the edit', async () => {
  const a = fakeGithub();
  await run({ github: a.github, context: ctx('opened', 'Bank statement format: UBS · CSV', report('UBS')), core });
  assert.deepEqual([...a.s.issueLabels].sort(), ['bank: UBS', 'new']);
  assert.equal(a.s.comments.length, 0);

  const b = fakeGithub(['new']);
  await run({ github: b.github, context: ctx('opened', 'Bank statement format: CSV / text', report('not given')), core });
  assert.deepEqual([...b.s.issueLabels].sort(), ['bank: unknown', 'new']);
  assert.equal(b.s.comments.length, 1);
  // edited, still nothing: no second comment
  await run({ github: b.github, context: ctx('edited', 'Bank statement format: CSV / text', report(''), [...b.s.issueLabels]), core });
  assert.equal(b.s.comments.length, 1);
  // the user names the bank: the label follows, "new" stays
  await run({ github: b.github, context: ctx('edited', 'Bank statement format: CSV / text', report('Valiant'), [...b.s.issueLabels]), core });
  assert.deepEqual([...b.s.issueLabels].sort(), ['bank: Valiant', 'new']);

  // other issues are left alone; "new" isn't put back on an edit
  const c = fakeGithub();
  await run({ github: c.github, context: ctx('opened', 'Crash on start', 'Steps'), core });
  await run({ github: c.github, context: ctx('edited', 'Bank statement format: PDF', report('N26'), ['bank: N26']), core });
  assert.deepEqual([...c.s.issueLabels], []);
});
