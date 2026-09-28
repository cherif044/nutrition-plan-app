// Real-user page speed: collects Core Web Vitals with native browser APIs and
// sends them once, when the page is hidden, to /api/vitals.
(function collectWebVitals() {
  if (typeof PerformanceObserver !== 'function' || !navigator.sendBeacon) return;

  const metrics = {};
  const supported = PerformanceObserver.supportedEntryTypes || [];
  const interactions = new Map();
  const observers = [];
  let clsSession = 0;
  let clsSessionStart = 0;
  let clsLastShift = 0;
  let sent = false;

  function observe(type, callback, options = {}) {
    if (!supported.includes(type)) return;
    try {
      const observer = new PerformanceObserver((list) => list.getEntries().forEach(callback));
      observer.observe({ type, buffered: true, ...options });
      observers.push({ observer, callback });
    } catch {
      // Older browsers reject some options; that metric is simply skipped.
    }
  }

  observe('paint', (entry) => {
    if (entry.name === 'first-contentful-paint') metrics.fcp = entry.startTime;
  });

  observe('largest-contentful-paint', (entry) => {
    metrics.lcp = entry.startTime;
  });

  // CLS is the worst "session window": shifts less than 1s apart, capped at 5s.
  observe('layout-shift', (entry) => {
    if (entry.hadRecentInput) return;
    const startsNewSession = entry.startTime - clsLastShift > 1000
      || entry.startTime - clsSessionStart > 5000;
    if (startsNewSession) {
      clsSession = 0;
      clsSessionStart = entry.startTime;
    }
    clsSession += entry.value;
    clsLastShift = entry.startTime;
    metrics.cls = Math.max(metrics.cls || 0, clsSession);
  });

  // INP: the slowest interaction, skipping one outlier per 50 interactions.
  observe('event', (entry) => {
    if (!entry.interactionId) return;
    const previous = interactions.get(entry.interactionId) || 0;
    interactions.set(entry.interactionId, Math.max(previous, entry.duration));
  }, { durationThreshold: 40 });

  function readNavigationTiming() {
    const navigation = performance.getEntriesByType('navigation')[0];
    if (!navigation) return;
    if (navigation.responseStart > 0) metrics.ttfb = navigation.responseStart;
    if (navigation.loadEventEnd > 0) metrics.load = navigation.loadEventEnd;
  }

  function send() {
    if (sent) return;
    sent = true;
    // Observer callbacks are delivered asynchronously; drain anything still
    // queued so a page hidden right after loading keeps its paint timings.
    observers.forEach(({ observer, callback }) => observer.takeRecords().forEach(callback));
    readNavigationTiming();
    if (interactions.size) {
      const durations = [...interactions.values()].sort((a, b) => b - a);
      metrics.inp = durations[Math.min(Math.floor(durations.length / 50), durations.length - 1)];
    }
    const payload = JSON.stringify({ page: location.pathname, metrics });
    navigator.sendBeacon('/api/vitals', new Blob([payload], { type: 'application/json' }));
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') send();
  });
  window.addEventListener('pagehide', send);
}());
