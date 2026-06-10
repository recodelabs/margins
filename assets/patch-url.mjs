// Normalize Roughdraft's client-side URL handling so reloads work and the URL
// doesn't flip-flop to the landing page.
//
// Roughdraft's DG() converts a no-leading-slash path into the CLEAN pathname
// form ("/x") and deletes ?path=. But the app reliably bootstraps a document
// only from the ?path= query (first load works; reload of "/x" lands on the
// welcome screen). Fix: (1) strip any leading slash, and (2) ALWAYS emit the
// ?path= query form. Result: a stable "/?path=x" URL that reloads correctly.
//
// Idempotent — applying twice is a no-op (the OLD strings are gone after the
// first pass). Pass the index-*.js bundle paths as args.
import fs from 'node:fs';

const reps = [
  // 1. strip leading slash from the derived path
  ['function DG(n){const e=(n==null?void 0:n.trim())||null,',
   'function DG(n){const e=(((n==null?void 0:n.trim())||"").replace(/^\\/+/,""))||null,'],
  // 2. force the ?path= query form instead of the clean pathname form
  ['(t.pathname=e.startsWith("/")?e:`/${e}`,t.searchParams.delete("path"))',
   '(t.pathname="/",t.searchParams.set("path",e))'],
];

for (const f of process.argv.slice(2)) {
  let s;
  try { s = fs.readFileSync(f, 'utf8'); } catch { continue; }
  let changed = false;
  for (const [O, N] of reps) {
    if (s.includes(O)) { s = s.split(O).join(N); changed = true; }
  }
  if (changed) { fs.writeFileSync(f, s); console.log('roughneck: normalized URL handling in ' + f.split('/').pop()); }
}
