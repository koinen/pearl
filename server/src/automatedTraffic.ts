const AUTOMATED_UA =
  /bot|crawl|spider|slurp|headless|puppeteer|playwright|selenium|phantom|lighthouse|curl|wget|python-requests|httpclient/i;

export interface BrowserSignals {
  /** The page saw at least one real mouse, scroll, key or touch event. */
  interacted: boolean;
  /** navigator.webdriver as reported by the browser. */
  webdriver: boolean;
}

/** True when a visit looks like Automated traffic, so no Proactive Trigger may fire for it. */
export function isAutomatedTraffic(userAgent: string | undefined, signals: BrowserSignals): boolean {
  if (!userAgent || AUTOMATED_UA.test(userAgent)) return true;
  if (signals.webdriver) return true;
  if (!signals.interacted) return true;
  return false;
}
