# Railway Deploy Notes

## Services

Create two services in the same Railway project:

1. `web` from this GitHub repo
2. `mysql` using Railway's MySQL template

## Web service

Railway should detect the `Dockerfile` automatically.

Set these variables on the `web` service:

- `DB_HOST=${{MySQL.MYSQLHOST}}`
- `DB_PORT=${{MySQL.MYSQLPORT}}`
- `DB_NAME=${{MySQL.MYSQLDATABASE}}`
- `DB_USER=${{MySQL.MYSQLUSER}}`
- `DB_PASS=${{MySQL.MYSQLPASSWORD}}`
- `JWT_SECRET_KEY=your-long-random-secret`
- `SMTP_HOST=smtp.gmail.com`
- `SMTP_PORT=587`
- `SMTP_USER=...`
- `SMTP_PASS=...`
- `GEMINI_API_KEY=...`

## Database

Import your schema/data into the Railway MySQL service after it is created.

## Important

- The `/terminal` feature is local-Docker dependent and will not work on Railway without a separate sandbox service.
- The app still stores uploads on local disk inside the container. This is acceptable for a demo, but object storage is better long-term.
