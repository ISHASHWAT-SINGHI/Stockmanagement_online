# StockPro Frontend

React 19 + Vite 7 single-page app for StockPro.

```bash
npm install
npm run dev      # http://localhost:5173 (proxies /api and /auth to http://127.0.0.1:8000)
npm run build    # production build → dist/
npm run lint
```

Set `VITE_API_URL` to the backend origin for production builds (e.g. on Vercel). Leave it unset for local development.

Full guide (routes, pages, shortcuts, billing calculations, deployment): [../docs/FRONTEND.md](../docs/FRONTEND.md). Project overview: [../README.md](../README.md).
