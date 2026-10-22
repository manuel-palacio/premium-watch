import { load } from 'cheerio';
import { extractText, getDocumentProxy } from 'unpdf';

/**
 * Downloads a source document and returns its plain text (HTML or PDF).
 * SEC requires a User-Agent naming a person and contact email: https://www.sec.gov/os/accessing-edgar-data
 */
export async function sourceText(url: string, env: NodeJS.ProcessEnv = process.env): Promise<string> {
  const host = new URL(url).hostname;
  const sec = host === 'sec.gov' || host.endsWith('.sec.gov');
  if (sec && !env.SEC_USER_AGENT) throw new Error('SEC_USER_AGENT is not set (SEC requires "Name email@example.com")');
  const res = await fetch(url, {
    headers: { 'user-agent': sec ? env.SEC_USER_AGENT! : 'Mozilla/5.0 (Macintosh) premium-watch', accept: 'text/html,application/pdf,application/json,*/*' },
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const type = res.headers.get('content-type') ?? '';
  const body = new Uint8Array(await res.arrayBuffer());
  if (type.includes('pdf') || url.toLowerCase().endsWith('.pdf')) {
    const { text } = await extractText(await getDocumentProxy(body), { mergePages: true });
    return text;
  }
  const raw = new TextDecoder().decode(body);
  if (type.includes('json')) return raw;
  const $ = load(raw);
  $('script, style').remove();
  return $('body').text() || $.root().text();
}
