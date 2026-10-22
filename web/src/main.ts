import '@fontsource-variable/recursive/casl.css';
import './style.css';
import { takePageCharts, type ChartHandle } from './charts.ts';
import { ApiError, apiCall, invalidate } from './data.ts';
import { h, mount, takeMounted } from './dom.ts';
import { initFirebase, signIn, signOutUser, watchUser } from './firebase.ts';
import { adminPage } from './views/admin.ts';
import { companyPage } from './views/company.ts';
import { comparePage } from './views/compare.ts';
import { overview } from './views/overview.ts';

const root = document.getElementById('app')!;
const main = h('main');
let userEmail = '';
let renderSeq = 0;
let shownCharts: ChartHandle[] = [];

function header(): HTMLElement {
  const route = location.hash.replace(/^#\/?/, '').split('/')[0] ?? '';
  const link = (href: string, label: string, on: boolean) => h('a', { href, class: on ? 'on' : '' }, label);
  return h(
    'header',
    { class: 'top' },
    h('a', { class: 'brand', href: '#/' }, h('span', { class: 'dot' }), 'Premium Watch'),
    h('nav', { class: 'tabs' }, link('#/', 'Overview', route === '' || route === 'company'), link('#/compare', 'Compare', route === 'compare'), link('#/admin', 'Admin', route === 'admin')),
    h(
      'div',
      { class: 'who' },
      h('span', { class: 'muted small' }, userEmail),
      h('button', { type: 'button', onclick: () => (invalidate(), signOutUser()) }, 'Sign out'),
    ),
  );
}

async function render(): Promise<void> {
  const seq = ++renderSeq;
  const [page, ...rest] = location.hash.replace(/^#\/?/, '').split('/');
  let view: HTMLElement;
  try {
    view =
      page === 'company' && rest[0]
        ? await companyPage(decodeURIComponent(rest[0]))
        : page === 'compare'
          ? await comparePage()
          : page === 'admin'
            ? await adminPage(rest[0] ?? '', render)
            : await overview();
  } catch (e) {
    console.error(e);
    view = h('div', { class: 'card' }, h('strong', null, 'Could not load data. '), h('span', { class: 'muted' }, (e as Error).message));
  }
  const charts = takePageCharts();
  const mounted = takeMounted();
  if (seq !== renderSeq) {
    // A newer navigation won; drop what this one built.
    for (const c of charts) c.destroy();
    return;
  }
  mount(main, view);
  mount(root, header(), main);
  for (const c of shownCharts) c.destroy();
  shownCharts = charts;
  for (const fn of mounted) fn();
}

function signInScreen(message?: string): void {
  const status = h('p', { class: 'small bad' }, message ?? '');
  mount(
    root,
    h(
      'div',
      { class: 'center-screen' },
      h(
        'div',
        { class: 'card' },
        h('h1', null, 'Premium Watch'),
        h('p', { class: 'muted' }, 'mNAV of crypto-treasury companies. Private dashboard.'),
        h(
          'button',
          {
            type: 'button',
            class: 'primary',
            onclick: async () => {
              status.textContent = '';
              try {
                await signIn();
              } catch (e) {
                status.textContent = (e as Error).message;
              }
            },
          },
          'Sign in with Google',
        ),
        status,
      ),
    ),
  );
}

async function start(): Promise<void> {
  try {
    await initFirebase();
  } catch (e) {
    mount(root, h('div', { class: 'center-screen' }, h('div', { class: 'card' }, h('strong', null, 'Cannot start: '), (e as Error).message)));
    return;
  }
  watchUser(async (user) => {
    if (!user) return signInScreen();
    try {
      await apiCall('GET', '/me');
    } catch (e) {
      await signOutUser();
      return signInScreen(e instanceof ApiError && e.status === 403 ? `${user.email} is not allowed to use this dashboard.` : (e as Error).message);
    }
    userEmail = user.email ?? '';
    await render();
  });
  window.addEventListener('hashchange', () => {
    window.scrollTo(0, 0);
    void render();
  });
}

void start();
