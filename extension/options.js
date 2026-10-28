import { writeProposal, PROVIDERS } from './lib/proposalEngine.js';
import { getConfig } from './config.js';

const $ = (id) => document.getElementById(id);
let config;

// Fields are bound by id: "engine.apiKey" -> config.engine.apiKey
const getPath = (obj, path) => path.split('.').reduce((o, k) => o?.[k], obj);
function setPath(obj, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  keys.reduce((o, k) => (o[k] ??= {}), obj)[last] = value;
}

let saveTimer;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    await chrome.storage.local.set({ config });
    $('saved').textContent = 'Saved.';
    setTimeout(() => ($('saved').textContent = 'Changes save automatically.'), 1200);
  }, 300);
}

function updateKeyLink() {
  $('keyLink').href = PROVIDERS[config.engine.provider]?.keyUrl || '#';
}

async function init() {
  config = await getConfig();

  const providerSel = $('engine.provider');
  for (const [id, p] of Object.entries(PROVIDERS)) providerSel.add(new Option(p.label, id));

  document.querySelectorAll('input[id], select[id], textarea[id]').forEach((el) => {
    if (el.id.startsWith('test')) return;
    const v = getPath(config, el.id);
    if (el.type === 'checkbox') el.checked = !!v;
    else el.value = v ?? '';
    el.addEventListener('input', () => {
      setPath(config, el.id, el.type === 'checkbox' ? el.checked : el.value);
      if (el.id === 'engine.provider') {
        config.engine.model = PROVIDERS[el.value].defaultModel;
        $('engine.model').value = config.engine.model;
        updateKeyLink();
      }
      save();
    });
  });
  updateKeyLink();

  document.querySelectorAll('nav button').forEach((b) => {
    b.onclick = () => {
      document.querySelectorAll('nav button, .tab').forEach((x) => x.classList.remove('on'));
      b.classList.add('on');
      $(b.dataset.tab).classList.add('on');
      if (b.dataset.tab === 'history') renderHistory();
    };
  });

  $('testRun').onclick = () => runTest('');
  $('testShorter').onclick = () => runTest('shorter');
  $('testDifferent').onclick = () => runTest('different');
  $('clearHistory').onclick = async () => {
    await chrome.storage.local.set({ history: [] });
    renderHistory();
  };

  if (!config.engine.apiKey) $('engine.apiKey').focus();
}

async function runTest(variant) {
  const job = $('testJob').value.trim();
  if (!job) return;
  $('testStatus').textContent = 'Writing...';
  try {
    const { text, analysis } = await writeProposal({ jobText: job, profile: config.profile, engine: config.engine, variant });
    $('testOut').value = text;
    const words = text.split(/\s+/).length;
    $('testStatus').textContent = `${words} words`;
    $('testChips').innerHTML = '';
    const chips = [
      analysis.platform !== 'generic' && analysis.platform,
      ...analysis.mustFollow.map((m) => `⚑ ${m}`),
      ...analysis.questions.map((q) => `? ${q}`),
    ].filter(Boolean);
    for (const c of chips) {
      const s = document.createElement('span');
      s.className = 'chip';
      s.textContent = c;
      $('testChips').append(s);
    }
  } catch (e) {
    $('testStatus').textContent = e.message;
  }
}

async function renderHistory() {
  const { history = [] } = await chrome.storage.local.get('history');
  const list = $('historyList');
  list.innerHTML = history.length ? '' : '<p class="muted">Nothing yet.</p>';
  for (const h of history) {
    const item = document.createElement('details');
    item.className = 'hist';
    const sum = document.createElement('summary');
    sum.textContent = `${new Date(h.at).toLocaleString()} · ${h.mode}${h.variant ? ` (${h.variant})` : ''} · ${h.job.slice(0, 90).replace(/\s+/g, ' ')}`;
    const pre = document.createElement('pre');
    pre.textContent = h.text;
    const actions = document.createElement('div');
    actions.className = 'row';
    const copyBtn = document.createElement('button');
    copyBtn.textContent = 'Copy';
    copyBtn.onclick = () => navigator.clipboard.writeText(h.text);
    actions.append(copyBtn);
    if (h.url) {
      const a = document.createElement('a');
      a.href = h.url;
      a.target = '_blank';
      a.textContent = 'Open job';
      actions.append(a);
    }
    item.append(sum, pre, actions);
    list.append(item);
  }
}

init();
