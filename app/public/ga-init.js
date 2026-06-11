// Google Analytics (gtag.js) init. Kept in an external file (not inline in
// index.html) so the CSP can stay `script-src 'self' …` without 'unsafe-inline'.
window.dataLayer = window.dataLayer || [];
function gtag() {
  dataLayer.push(arguments);
}
gtag("js", new Date());
gtag("config", "G-64N6TSZHV5");
