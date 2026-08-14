# Story Devils — сервер

Node.js/Express-сервер + Postgres. Без логина (доступ по ссылке), с историей
удалений, серверными бэкапами (пароль `7897`) и без слоёв — доска единая.

## Из чего состоит

```
server.js      — Express: REST-хранилище для доски, история/бэкапы, /api/health
db.js          — подключение к Postgres, создание таблиц при первом запуске
public/index.html — сама доска (фронтенд)
.env.example   — какие переменные окружения нужны
```

## Проверка базы

Откройте `https://ваш-сайт/api/health` — покажет, жива ли база.

## Запуск

```
npm install
npm start
```

Переменные окружения (`.env`, скопировать из `.env.example`):
```
DATABASE_URL=<строка подключения к Postgres>
NODE_ENV=production
PORT=3000
```

## Деплой

GitHub → Railway (или Render) → New Web Service → указать `DATABASE_URL` в Environment → Deploy.
