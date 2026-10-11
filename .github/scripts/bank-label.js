// Labels "Bank statement format" requests (from the Pocket Atlas app or the issue
// template) with the bank they are about: "bank: <name>", or "bank: unknown" plus a
// one-time comment asking for the name. New requests also get "new".
//
// The app's report masks every name, IBAN, amount and text, so the bank comes from
//   1. the "- Bank: …" line (typed by the user in the app or the template),
//   2. the profile the app recognised ("profile `ch.migros-pdf`"),
//   3. a known bank's name anywhere in the title or body,
//   4. a layout only one known bank uses (header words survive the masking).
// Pure detection is `detectBank`; `run` is called from .github/workflows/bank-label.yml.
'use strict';

/** Canonical names and the ways people write them (lower case, matched on word boundaries). */
const BANKS = [
  ['UBS', ['ubs']],
  ['PostFinance', ['postfinance', 'post finance']],
  ['Zürcher Kantonalbank', ['zkb', 'zürcher kantonalbank', 'zurcher kantonalbank', 'zuercher kantonalbank']],
  ['Berner Kantonalbank', ['bekb', 'berner kantonalbank']],
  ['Luzerner Kantonalbank', ['lukb', 'luzerner kantonalbank']],
  ['St. Galler Kantonalbank', ['sgkb', 'st. galler kantonalbank', 'st.galler kantonalbank', 'st galler kantonalbank']],
  ['Basler Kantonalbank', ['bkb', 'basler kantonalbank']],
  ['Aargauische Kantonalbank', ['akb', 'aargauische kantonalbank']],
  ['Banque Cantonale Vaudoise', ['bcv', 'banque cantonale vaudoise']],
  ['Banque Cantonale de Genève', ['bcge', 'banque cantonale de genève', 'banque cantonale de geneve']],
  ['Raiffeisen', ['raiffeisen', 'raiffeisenbank', 'elba']],
  ['Migros Bank', ['migros bank', 'migrosbank', 'migros']],
  ['Credit Suisse', ['credit suisse']],
  ['Valiant', ['valiant']],
  ['Cler', ['bank cler', 'cler']],
  ['Swissquote', ['swissquote']],
  ['Yuh', ['yuh']],
  ['neon', ['neon']],
  ['Cembra', ['cembra']],
  ['Revolut', ['revolut']],
  ['Wise', ['wise', 'transferwise']],
  ['N26', ['n26']],
  ['Volksbank', ['volksbank']],
  ['Erste Bank', ['erste bank', 'erste group']],
  ['Sparkasse', ['sparkasse']],
  ['BAWAG', ['bawag', 'bawag p.s.k.', 'psk']],
  ['Bank Austria', ['bank austria']],
  ['Hypo', ['hypo']],
  ['Oberbank', ['oberbank']],
  ['easybank', ['easybank']],
  ['DKB', ['dkb', 'deutsche kreditbank']],
  ['ING', ['ing', 'ing-diba', 'ing diba']],
  ['Commerzbank', ['commerzbank']],
  ['comdirect', ['comdirect']],
  ['Deutsche Bank', ['deutsche bank']],
  ['Postbank', ['postbank']],
  ['Consorsbank', ['consorsbank']],
  ['Trade Republic', ['trade republic']],
];

/** The app's built-in profiles (src/data/core/statementProfiles.ts and the PDF profiles). */
const PROFILES = {
  'at.raiffeisen-elba': 'Raiffeisen',
  'online.revolut': 'Revolut',
  'ch.migros-pdf': 'Migros Bank',
  'at.volksbank-pdf': 'Volksbank',
};

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const ALIASES = BANKS.flatMap(([name, aliases]) => aliases.map((a) => [name, a]))
  // longest first: "migros bank" before "migros", "bank austria" before "austria"
  .sort((a, b) => b[1].length - a[1].length)
  .map(([name, a]) => [name, new RegExp(`(?<![\\p{L}\\p{N}])${escape(a)}(?![\\p{L}\\p{N}])`, 'iu')]);

/** A known bank in this text, or null. */
function knownBank(text) {
  for (const [name, re] of ALIASES) if (re.test(text)) return name;
  return null;
}

/** A typed name as a label: known names canonical, the rest tidied to one short line. */
function bankName(typed) {
  const known = knownBank(typed);
  if (known) return known;
  const clean = typed.replace(/[^\p{L}\p{N} .&'()+-]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 40).trim();
  if (!clean || /^(not given|none|n\/?a|-+|\?+|unknown|keine|unbekannt)$/i.test(clean)) return null;
  return clean;
}

/** Is this issue a bank statement format request? */
function isFormatRequest(title, body) {
  return /^\s*Bank statement format\b/i.test(title ?? '') || /Sent from Pocket Atlas/i.test(body ?? '') || /^### Bank\b/m.test(body ?? '');
}

/** The masked table's / PDF's header words (kept by the app's masking) that only one known bank prints. */
function layoutBank(body) {
  const lower = body.toLowerCase();
  if (/type\s*\|\s*product\s*\|\s*started date\s*\|\s*completed date/.test(lower)) return 'Revolut';
  if (/:alter saldo per\b/.test(lower) && /:datum\b[\s\S]{0,400}:buchungstext\b[\s\S]{0,400}:wert\b[\s\S]{0,400}:betrag\b/.test(lower)) return 'Volksbank';
  return null;
}

/** { name, source } of the bank this request is about, or null. */
function detectBank(title, body) {
  title = title ?? '';
  body = body ?? '';
  // 1. typed by the user: the app's "- Bank: …", the template's "- Bank: …" / "- Bank / country: …"
  const typed = /^[-*]\s*Bank(?:\s*\/\s*country)?\s*:[ \t]*(.*)$/im.exec(body);
  if (typed) {
    const name = bankName(typed[1].split(/[,;]/)[0]);
    if (name) return { name, source: 'typed' };
  }
  // 2. the profile the app recognised
  const profile = /profile `([^`]+)`/.exec(body);
  if (profile && PROFILES[profile[1]]) return { name: PROFILES[profile[1]], source: 'profile' };
  // 3. a known name in the title (after "Bank statement format:") or the body
  const named = knownBank(title.replace(/^\s*Bank statement format\s*:?/i, '')) ?? knownBank(body);
  if (named) return { name: named, source: 'text' };
  // 4. a layout only one known bank uses
  const layout = layoutBank(body);
  if (layout) return { name: layout, source: 'layout' };
  return null;
}

const BANK_PREFIX = 'bank: ';
const UNKNOWN = `${BANK_PREFIX}unknown`;
const COLORS = { new: '0e8a16', bank: '1d76db', unknown: 'fbca04' };
const ASK_MARKER = '<!-- bank-label:ask -->';

async function ensureLabel(github, repo, name, color, description) {
  try {
    await github.rest.issues.getLabel({ ...repo, name });
  } catch (e) {
    if (e.status !== 404) throw e;
    try {
      await github.rest.issues.createLabel({ ...repo, name, color, description });
    } catch (err) {
      if (err.status !== 422) throw err; // created meanwhile
    }
  }
}

async function run({ github, context, core }) {
  const issue = context.payload.issue;
  if (!issue || issue.pull_request) return;
  if (!isFormatRequest(issue.title, issue.body)) {
    core.info('Not a bank statement format request.');
    return;
  }
  const repo = context.repo;
  const number = issue.number;
  const has = new Set((issue.labels ?? []).map((l) => (typeof l === 'string' ? l : l.name)));
  const add = [];

  // "new" once, when the request comes in (a maintainer may take it off later)
  if (context.payload.action === 'opened' && !has.has('new')) {
    await ensureLabel(github, repo, 'new', COLORS.new, 'Not looked at yet');
    add.push('new');
  }

  const found = detectBank(issue.title, issue.body);
  const want = found ? `${BANK_PREFIX}${found.name}`.slice(0, 50) : UNKNOWN;
  core.info(found ? `Bank: ${found.name} (from ${found.source})` : 'Bank not found.');
  if (!has.has(want)) {
    if (found) await ensureLabel(github, repo, want, COLORS.bank, `Statement format requests for ${found.name}`);
    else await ensureLabel(github, repo, UNKNOWN, COLORS.unknown, 'The bank is not named yet');
    add.push(want);
  }
  if (add.length) await github.rest.issues.addLabels({ ...repo, issue_number: number, labels: add });

  // the bank label follows edits: drop the other "bank: …" ones
  for (const name of has) {
    if (name.startsWith(BANK_PREFIX) && name !== want) {
      await github.rest.issues.removeLabel({ ...repo, issue_number: number, name }).catch((e) => {
        if (e.status !== 404) throw e;
      });
    }
  }

  // not named: ask once
  if (!found) {
    const comments = await github.paginate(github.rest.issues.listComments, { ...repo, issue_number: number, per_page: 100 });
    if (!comments.some((c) => (c.body ?? '').includes(ASK_MARKER))) {
      await github.rest.issues.createComment({
        ...repo,
        issue_number: number,
        body: `${ASK_MARKER}\nThanks for the report! Which bank is this statement from? Please edit the issue and fill in the \`- Bank:\` line (for example \`- Bank: PostFinance\`) — the label follows.\n\nDanke für den Bericht! Von welcher Bank ist dieser Auszug? Bitte bearbeiten Sie das Issue und ergänzen Sie die Zeile \`- Bank:\` (zum Beispiel \`- Bank: PostFinance\`) — das Label passt sich an.`,
      });
    }
  }
}

module.exports = run;
module.exports.detectBank = detectBank;
module.exports.isFormatRequest = isFormatRequest;
