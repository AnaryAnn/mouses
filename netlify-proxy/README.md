# Посредник Netlify для API сайта

Основной сайт продолжает работать на GitHub Pages. Этот проект не содержит паролей или ключей и не изменяет конфигурацию Python-бота.

## Подключение

В Netlify: Add new project → Import an existing project → GitHub → AnaryAnn/mouses.

- Branch: main.
- Base directory: netlify-proxy.
- Build command: оставить пустым.
- Publish directory: public (относительно Base directory).
- Functions directory: functions (задаётся netlify.toml).
- Environment variables: не нужны.
- План: Free; не включать платные дополнения.

После публикации открыть адрес проекта без VPN, затем /health. Ответ должен содержать ok: true. Для проверки авторизации без пароля открыть /api/website/login: ожидается HTTP 401. Это не проверяет правильный пароль.

Переключать URL в app.js и treasury.js только после проверки Netlify без VPN. CORS разрешает только https://anaryann.github.io; пароли передаются из браузера в заголовке и проверяются Python на Render. Ответы не кешируются посредником. Кеш статистики остаётся в существующем API и браузере.

Автоматических повторов записи нет: повтор отчёта должен использовать прежний requestId сайта. Netlify не исправляет ошибки и засыпание Render. Задания расписания и Callback API VK не переключаются.

Локальная проверка: node --test tests/netlify-proxy.mjs из корня репозитория.
