# AIZEA website

Static Astro site for the AIZEA product narrative. It contains no backend, runtime API calls, secrets, source PDFs, local databases, or private application files. Product visuals are CSS-built conceptual representations and are labelled where they are not current screenshots.

## Development

Requires Node.js 20 or newer.

```bash
npm install
npm run dev
```

The production build is generated in `dist/`:

```bash
npm run build
npm run preview
```

Astro is configured with `base: '/aizea/'` for GitHub Pages. The workflow at `.github/workflows/deploy-pages.yml` builds this directory and deploys the generated static artifact using the official Pages actions. Deployment is controlled by the repository workflow; this README does not claim a live deployment URL.
