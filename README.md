# Linda

Minimal test service backed by OpenAI, deployed on Railway.

## Endpoints

- `GET /health` — service + model status.
- `POST /api/chat` — `{ "message": "..." }` → OpenAI chat completion (model: `OPENAI_MODEL`, defaults to `gpt-4o-mini`, the cheapest generally-available OpenAI chat model).
- `GET /admin?token=<ADMIN_TOKEN>` — usage/cost dashboard (request count, token totals, estimated spend, recent errors).

## Environment variables

- `OPENAI_API_KEY` — required.
- `OPENAI_MODEL` — optional, defaults to `gpt-4o-mini`.
- `ADMIN_TOKEN` — required to enable `/admin`.
- `PORT` — provided by Railway.

## Local dev

```
npm install
OPENAI_API_KEY=sk-... ADMIN_TOKEN=devtoken npm start
```
