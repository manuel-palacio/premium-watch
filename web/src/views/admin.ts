import {
  ASSETS,
  CURRENCIES,
  EXCHANGES,
  EXCHANGE_CODES,
  LEDGER_CSV_COLUMNS,
  LEDGER_TYPES,
  MNAV_VARIANTS,
  describeAlert,
  type Alert,
  type Company,
} from '@pw/shared';
import { ApiError, alertEvents, alerts, apiCall, companies, invalidate, ledger, today } from '../data.ts';
import { errorList, formData, h } from '../dom.ts';
import { plain } from '../format.ts';

type Rerender = () => void;

const TABS = [
  ['', 'Companies'],
  ['ledger', 'Ledger'],
  ['import', 'CSV import'],
  ['alerts', 'Alerts'],
  ['history', 'Alert history'],
] as const;

export async function adminPage(tab: string, rerender: Rerender): Promise<HTMLElement> {
  const nav = h(
    'div',
    { class: 'seg', style: 'margin-bottom:18px; flex-wrap:wrap' },
    TABS.map(([id, label]) => h('button', { type: 'button', class: id === tab ? 'on' : '', onclick: () => (location.hash = id ? `#/admin/${id}` : '#/admin') }, label)),
  );
  const content =
    tab === 'ledger' ? await ledgerTab(rerender) : tab === 'import' ? importTab(rerender) : tab === 'alerts' ? await alertsTab(rerender) : tab === 'history' ? await historyTab() : await companiesTab(rerender);
  return h('div', null, h('h1', null, 'Admin'), h('p', { class: 'sub' }, 'Changes are written through the admin API, which checks every field.'), nav, content);
}

/** Submit handler that shows API errors under the form and re-renders on success. */
function submitter(form: HTMLFormElement, status: HTMLElement, run: (data: Record<string, string | boolean>) => Promise<string | void>, rerender: Rerender) {
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const btn = form.querySelector<HTMLButtonElement>('button[type=submit]');
    if (btn) btn.disabled = true;
    status.replaceChildren();
    try {
      const msg = await run(formData(form));
      if (msg) status.replaceChildren(h('p', { class: 'ok' }, msg));
      rerender();
    } catch (e) {
      status.replaceChildren(errorList(e instanceof ApiError ? e.errors : [(e as Error).message]));
    } finally {
      if (btn) btn.disabled = false;
    }
  });
}

const select = (name: string, options: readonly string[], value?: string, labels?: (o: string) => string) =>
  h('select', { name }, options.map((o) => h('option', { value: o, selected: o === value }, labels ? labels(o) : o)));
const field = (label: string, control: HTMLElement, cls = '') => h('label', { class: `field ${cls}` }, label, control);

// Companies ---------------------------------------------------------------

async function companiesTab(rerender: Rerender): Promise<HTMLElement> {
  const list = await companies();
  const editing: { current: Company | null } = { current: null };
  const status = h('div');
  const formHost = h('div');

  const renderForm = () => {
    const c = editing.current;
    const form = h(
      'form',
      { class: 'form' },
      field('Id (lowercase, used in URLs)', h('input', { name: 'id', required: true, value: c?.id ?? '', readonly: Boolean(c), pattern: '[a-z0-9][a-z0-9\\-]{0,39}', placeholder: 'mstr' })),
      field('Name', h('input', { name: 'name', required: true, value: c?.name ?? '', placeholder: 'Strategy' })),
      field('Ticker', h('input', { name: 'ticker', required: true, value: c?.ticker ?? '', placeholder: 'MSTR or 3350' })),
      field('Exchange', select('exchange', EXCHANGE_CODES, c?.exchange, (o) => EXCHANGES[o as Company['exchange']].name)),
      field('Currency', select('currency', CURRENCIES, c?.currency)),
      field('Treasury asset', select('asset', ASSETS, c?.asset)),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'active', checked: c ? c.active : true }), 'Active'),
      h(
        'div',
        { class: 'wide', style: 'display:flex; gap:8px' },
        h('button', { type: 'submit', class: 'primary' }, c ? 'Save changes' : 'Add company'),
        c ? h('button', { type: 'button', onclick: () => ((editing.current = null), renderForm()) }, 'Cancel') : null,
      ),
    );
    submitter(
      form,
      status,
      async (d) => {
        if (c) await apiCall('PUT', `/admin/companies/${c.id}`, d);
        else await apiCall('POST', '/admin/companies', d);
        invalidate('companies');
        return `${d.name} saved.`;
      },
      rerender,
    );
    formHost.replaceChildren(h('h2', null, c ? `Edit ${c.name}` : 'Add a company'), h('div', { class: 'card' }, form, status));
  };
  renderForm();

  return h(
    'div',
    null,
    h(
      'div',
      { class: 'table-wrap cards' },
      h(
        'table',
        null,
        h('thead', null, h('tr', null, ['Company', 'Ticker', 'Exchange', 'Currency', 'Asset', 'Active', ''].map((x) => h('th', null, x)))),
        h(
          'tbody',
          null,
          list.map((c) =>
            h(
              'tr',
              null,
              h('td', { class: 'head', 'data-label': 'Company' }, h('a', { href: `#/company/${c.id}` }, c.name)),
              h('td', { 'data-label': 'Ticker' }, c.ticker),
              h('td', { 'data-label': 'Exchange' }, c.exchange),
              h('td', { 'data-label': 'Currency' }, c.currency),
              h('td', { 'data-label': 'Asset' }, c.asset),
              h('td', { 'data-label': 'Active' }, c.active ? 'yes' : 'no'),
              h('td', { 'data-label': '' }, h('button', { type: 'button', onclick: () => ((editing.current = c), renderForm(), formHost.scrollIntoView({ behavior: 'smooth' })) }, 'Edit')),
            ),
          ),
        ),
      ),
    ),
    formHost,
  );
}

// Ledger ------------------------------------------------------------------

async function ledgerTab(rerender: Rerender): Promise<HTMLElement> {
  const [list, entries] = await Promise.all([companies(), ledger()]);
  if (!list.length) return h('div', { class: 'card empty' }, 'Add a company first.');
  const name = new Map(list.map((c) => [c.id, c.name]));
  const status = h('div');
  const form = h(
    'form',
    { class: 'form' },
    field('Company', select('companyId', list.map((c) => c.id), undefined, (id) => name.get(id) ?? id)),
    field('Type', select('type', LEDGER_TYPES)),
    field('Effective date', h('input', { name: 'effectiveDate', type: 'date', required: true, value: today() })),
    field('Value', h('input', { name: 'value', required: true, inputmode: 'decimal', placeholder: 'coins, shares, or money in the company currency' })),
    field('Source URL (required)', h('input', { name: 'sourceUrl', type: 'url', required: true, placeholder: 'https://… filing or press release' }), 'wide'),
    field('Note', h('input', { name: 'note', placeholder: 'optional' }), 'wide'),
    h('div', { class: 'wide' }, h('button', { type: 'submit', class: 'primary' }, 'Add entry')),
  );
  submitter(
    form,
    status,
    async (d) => {
      await apiCall('POST', '/admin/ledger', d);
      invalidate('ledger');
      return 'Entry added. Snapshots pick it up on the next job run; run a backfill with --force to rebuild past days.';
    },
    rerender,
  );

  const del = async (id: string) => {
    if (!confirm('Delete this ledger entry?')) return;
    await apiCall('DELETE', `/admin/ledger/${id}`);
    invalidate('ledger');
    rerender();
  };

  return h(
    'div',
    null,
    h(
      'div',
      { class: 'card' },
      h('p', { class: 'small muted', style: 'margin-top:0' }, 'Each entry sets the value from its effective date onward (not a delta). Debt, preferred (liquidation value) and cash are in the company’s currency.'),
      form,
      status,
    ),
    h('h2', null, `Entries (${entries.length})`),
    h(
      'div',
      { class: 'table-wrap cards' },
      h(
        'table',
        null,
        h('thead', null, h('tr', null, ['Company', 'Effective', 'Type', 'Value', 'Source', 'Note', ''].map((x, i) => h('th', { class: i === 3 ? 'num' : '' }, x)))),
        h(
          'tbody',
          null,
          entries.slice(0, 300).map((e) =>
            h(
              'tr',
              null,
              h('td', { class: 'head', 'data-label': 'Company' }, name.get(e.companyId) ?? e.companyId),
              h('td', { class: 'mono', 'data-label': 'Effective' }, e.effectiveDate),
              h('td', { 'data-label': 'Type' }, e.type),
              h('td', { class: 'num', 'data-label': 'Value' }, plain(e.value)),
              h('td', { 'data-label': 'Source' }, h('a', { href: e.sourceUrl, target: '_blank', rel: 'noopener noreferrer' }, 'link')),
              h('td', { class: 'small muted', 'data-label': 'Note' }, e.note ?? ''),
              h('td', { 'data-label': '' }, h('button', { type: 'button', class: 'danger', onclick: () => del(e.id) }, 'Delete')),
            ),
          ),
        ),
      ),
    ),
  );
}

// CSV import --------------------------------------------------------------

const EXAMPLE = `${LEDGER_CSV_COLUMNS.join(',')}
mstr,2026-10-20,holdings,640031,https://www.strategy.com/press,8-K
metaplanet,2026-10-01,debt,15000000000,https://metaplanet.jp/en/shareholders/disclosures,"JPY, bonds"`;

function importTab(rerender: Rerender): HTMLElement {
  const area = h('textarea', { name: 'csv', placeholder: EXAMPLE, spellcheck: false });
  const file = h('input', { type: 'file', accept: '.csv,text/csv' });
  const status = h('div');
  file.addEventListener('change', async () => {
    const f = file.files?.[0];
    if (f) area.value = await f.text();
  });
  const send = async (dryRun: boolean) => {
    status.replaceChildren(h('p', { class: 'muted small' }, dryRun ? 'Validating…' : 'Importing…'));
    try {
      const r = await apiCall<{ valid?: number; imported: number }>('POST', `/admin/ledger/import${dryRun ? '?dryRun=1' : ''}`, area.value, 'text/csv');
      status.replaceChildren(h('p', { class: 'ok' }, dryRun ? `${r.valid} row(s) valid. Nothing written yet.` : `${r.imported} row(s) imported.`));
      if (!dryRun) {
        invalidate('ledger');
        area.value = '';
        setTimeout(rerender, 1200);
      }
    } catch (e) {
      status.replaceChildren(h('p', { class: 'bad small' }, 'Nothing was imported. Fix these rows and try again:'), errorList(e instanceof ApiError ? e.errors : [(e as Error).message]));
    }
  };
  return h(
    'div',
    { class: 'card' },
    h('p', { style: 'margin-top:0' }, 'Header row required. Columns: ', h('code', null, LEDGER_CSV_COLUMNS.join(', ')), ' (note optional). ', 'Types: ', h('code', null, LEDGER_TYPES.join(', ')), '. Dates YYYY-MM-DD. Every row needs a source URL. The import is all-or-nothing.'),
    h('div', { style: 'display:grid; gap:10px' }, file, area),
    h('div', { style: 'display:flex; gap:8px; margin-top:10px' }, h('button', { type: 'button', onclick: () => send(true) }, 'Validate'), h('button', { type: 'button', class: 'primary', onclick: () => send(false) }, 'Import')),
    status,
  );
}

// Alerts ------------------------------------------------------------------

async function alertsTab(rerender: Rerender): Promise<HTMLElement> {
  const [list, all] = await Promise.all([companies(), alerts()]);
  if (!list.length) return h('div', { class: 'card empty' }, 'Add a company first.');
  const name = new Map(list.map((c) => [c.id, c.name]));
  const status = h('div');
  const params = h('div', { class: 'wide form', style: 'display:grid' });
  const ruleSel = select('rule', ['mnav_below', 'mnav_above', 'compression_pct_over_days'], 'mnav_below', (r) =>
    r === 'mnav_below' ? 'mNAV below X' : r === 'mnav_above' ? 'mNAV above X' : 'mNAV fell more than X% over N days',
  );
  const renderParams = () => {
    const r = ruleSel.value;
    params.replaceChildren(
      field('Variant', select('variant', MNAV_VARIANTS, 'diluted')),
      ...(r === 'compression_pct_over_days'
        ? [field('Drop more than (%)', h('input', { name: 'pct', required: true, inputmode: 'decimal', value: '20' })), field('Over (days)', h('input', { name: 'days', required: true, inputmode: 'numeric', value: '30' }))]
        : [field('Threshold (×)', h('input', { name: 'threshold', required: true, inputmode: 'decimal', value: '1.0' }))]),
    );
  };
  ruleSel.addEventListener('change', renderParams);
  renderParams();

  const form = h(
    'form',
    { class: 'form' },
    field('Company', select('companyId', list.map((c) => c.id), undefined, (id) => name.get(id) ?? id)),
    field('Rule', ruleSel),
    params,
    h('div', { class: 'wide' }, h('button', { type: 'submit', class: 'primary' }, 'Add alert')),
  );
  const toPayload = (d: Record<string, string | boolean>) => ({
    companyId: d.companyId,
    rule: d.rule,
    enabled: true,
    params: d.rule === 'compression_pct_over_days' ? { variant: d.variant, pct: Number(d.pct), days: Number(d.days) } : { variant: d.variant, threshold: Number(d.threshold) },
  });
  submitter(
    form,
    status,
    async (d) => {
      await apiCall('POST', '/admin/alerts', toPayload(d));
      invalidate('alerts');
      return 'Alert added.';
    },
    rerender,
  );

  const toggle = async (a: Alert) => {
    await apiCall('PUT', `/admin/alerts/${a.id}`, { companyId: a.companyId, rule: a.rule, params: a.params, enabled: !a.enabled });
    invalidate('alerts');
    rerender();
  };
  const del = async (a: Alert) => {
    if (!confirm('Delete this alert?')) return;
    await apiCall('DELETE', `/admin/alerts/${a.id}`);
    invalidate('alerts');
    rerender();
  };

  return h(
    'div',
    null,
    h(
      'p',
      { class: 'small muted' },
      'An alert emails you when its condition becomes true, then stays quiet until the condition has been false again. Stale snapshots are not evaluated.',
    ),
    all.length
      ? h(
          'div',
          { class: 'table-wrap cards' },
          h(
            'table',
            null,
            h('thead', null, h('tr', null, ['Company', 'Rule', 'State', ''].map((x) => h('th', null, x)))),
            h(
              'tbody',
              null,
              all.map((a) =>
                h(
                  'tr',
                  null,
                  h('td', { class: 'head', 'data-label': 'Company' }, name.get(a.companyId) ?? a.companyId),
                  h('td', { 'data-label': 'Rule' }, describeAlert(a)),
                  h('td', { 'data-label': 'State' }, !a.enabled ? h('span', { class: 'badge' }, 'disabled') : a.active ? h('span', { class: 'badge warn' }, `triggered ${a.activeSince?.slice(0, 10) ?? ''}`) : h('span', { class: 'badge' }, 'armed')),
                  h(
                    'td',
                    { 'data-label': '' },
                    h('button', { type: 'button', onclick: () => toggle(a) }, a.enabled ? 'Disable' : 'Enable'),
                    ' ',
                    h('button', { type: 'button', class: 'danger', onclick: () => del(a) }, 'Delete'),
                  ),
                ),
              ),
            ),
          ),
        )
      : h('div', { class: 'card empty' }, 'No alerts yet.'),
    h('h2', null, 'Add an alert'),
    h('div', { class: 'card' }, form, status),
  );
}

async function historyTab(): Promise<HTMLElement> {
  const [events, list] = await Promise.all([alertEvents(), companies()]);
  const name = new Map(list.map((c) => [c.id, c.name]));
  if (!events.length) return h('div', { class: 'card empty' }, 'No alerts have fired yet.');
  return h(
    'div',
    { class: 'table-wrap cards' },
    h(
      'table',
      null,
      h('thead', null, h('tr', null, ['Fired', 'Company', 'Value', 'Message'].map((x, i) => h('th', { class: i === 2 ? 'num' : '' }, x)))),
      h(
        'tbody',
        null,
        events.map((e) =>
          h(
            'tr',
            null,
            h('td', { class: 'head mono', 'data-label': 'Fired' }, e.firedAt.slice(0, 16).replace('T', ' ')),
            h('td', { 'data-label': 'Company' }, h('a', { href: `#/company/${e.companyId}` }, name.get(e.companyId) ?? e.companyId)),
            h('td', { class: 'num', 'data-label': 'Value' }, e.value.toFixed(2)),
            h('td', { class: 'small', 'data-label': 'Message' }, e.message),
          ),
        ),
      ),
    ),
  );
}
