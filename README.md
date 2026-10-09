# leto.prulwerk.nl

The published site for Leto: the landing page, `/demo/` and a copy of the app that runs it on synthetic fixtures. GitHub Pages serves the root of `main`.

**This repository is a build output.** `npm run site` in the source repository (`tools/make-site.mjs`, source in `site/`) writes `dist/leto.prulwerk.nl/`, and that tree is what lands here. Edit `site/` there and rebuild; a change made only here is lost on the next build. Before rebuilding, check that nothing landed here that the source does not yet have (`git log` here against `site/` there).

The app under `src/` is the extension's own code, copied so `/demo/` can run it on `fixtures/` with no server and no key. Nothing in `fixtures/` comes from a real account.
