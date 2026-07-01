# How much retirement does it cost?

A tiny, client-only web app that shows what a purchase _really_ costs you — in
future retirement money and in time.

Set up your plan once (it's saved in your browser), then type the price of
something you're eyeing. The app shows how much that money would grow to by the
time you retire if you invested it instead, and how much sooner you could retire.

## What it does

Your plan:

- Birth date
- Current savings
- Preferred currency
- How much you invest monthly
- Real yearly yield (your return after inflation)
- How much you want to have when you retire

For any price, it then shows:

- **What it could grow to** by retirement — the future value you'd forgo
- **How much it delays your retirement**
- The **growth multiple** (e.g. `4.8×`)

Plus a **projected growth chart** with a ±2 percentage-point return range band and
a hover tooltip with the values at any point in time.

It's fully deterministic (no Monte Carlo) and runs entirely in your browser — no
backend, no tracking. Settings persist via `localStorage`.

## Development

Requires [pnpm](https://pnpm.io).

```sh
pnpm install
pnpm dev      # start the dev server
pnpm build    # type-check and build to dist/
pnpm preview  # preview the production build
```

Built with [Vite](https://vite.dev) and vanilla TypeScript, with no runtime
dependencies. The financial math lives in `src/finance.ts`, the chart in
`src/chart.ts`, and the UI wiring in `src/main.ts`.

## Disclaimer

This is a simple projection tool, not financial advice.

## License

[MIT](LICENSE) © Carlos Alexandro Becker
