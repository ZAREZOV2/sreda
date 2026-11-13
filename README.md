# Среда

<p align="center">
  <img src="docs/banner.png" alt="Среда — всё под рукой. Локально, приватно и спокойно." width="100%" />
</p>

Локальные канбан-доски и Markdown-документы для Windows. Доски, документы, темы и база SQLite остаются на вашем компьютере. Совместная работа — по ссылке-приглашению. MCP для ИИ выключен, пока вы сами его не включите.

[![CI](https://github.com/ZAREZOV2/sreda/actions/workflows/ci.yml/badge.svg)](https://github.com/ZAREZOV2/sreda/actions/workflows/ci.yml)
[![Релиз](https://img.shields.io/github/v/release/ZAREZOV2/sreda?label=%D1%80%D0%B5%D0%BB%D0%B8%D0%B7)](https://github.com/ZAREZOV2/sreda/releases/latest)
[![Лицензия GPL-3.0](https://img.shields.io/badge/license-GPL--3.0--or--later-blue)](LICENSE)
[![Платформа Windows](https://img.shields.io/badge/platform-Windows%20x64-lightgrey)](#установка)
[![Tauri](https://img.shields.io/badge/built%20with-Tauri%202%20%C2%B7%20Rust%20%C2%B7%20React-orange)](https://tauri.app)

**[Скачать установщик 0.3.0](https://github.com/ZAREZOV2/sreda/releases/download/v0.3.0/Sreda_0.3.0_x64-setup.exe)** · [все релизы](https://github.com/ZAREZOV2/sreda/releases) · [English](README.en.md)

## Возможности

- Доски, колонки с типом «нужно сделать / в работе / готово», карточки, метки, приоритет, перетаскивание.
- Документы: визуальный редактор и исходный Markdown, GFM, callout, KaTeX, Mermaid, папки, оглавление, шаблоны, история версий, экспорт HTML и PDF.
- Описание карточки в Markdown, связь документа с карточкой, чек-лист `- [ ]` ↔ карточки, ссылки `[[Документ]]`.
- Полнотекстовый поиск по документам и карточкам (SQLite FTS5).
- Помидор и учёт времени, повторяющиеся задачи, локальные напоминания.
- Темы `*.sreda-theme.json`, редактор «на основе текущей», проверка контраста, перетаскивание файла темы в окно.
- Совместная работа по ссылке (WebSocket; при желании через ngrok) и передача темы участникам.
- MCP для Claude Desktop и Cursor: по умолчанию выключен, HTTP только на `127.0.0.1`.

## Скриншоты

![Доска](docs/screenshots/board.png)

![Документ](docs/screenshots/document.png)

![Настройки](docs/screenshots/settings.png)

## Установка

Нужен Windows x64. Скачайте [Sreda_0.3.0_x64-setup.exe](https://github.com/ZAREZOV2/sreda/releases/download/v0.3.0/Sreda_0.3.0_x64-setup.exe) со [страницы релиза v0.3.0](https://github.com/ZAREZOV2/sreda/releases/tag/v0.3.0). В списке файлов установщик подписан как «Среда_0.3.0_x64-setup.exe», само имя файла — `Sreda_0.3.0_x64-setup.exe`. Рядом лежит `sreda-mcp.exe`: он уже входит в установщик, отдельный файл нужен только если MCP подключаете без окна приложения.

WebView2 установщик скачает сам, если его ещё нет. Данные остаются в `%LOCALAPPDATA%\local.sreda.kanban`.

## Сборка из исходников

Windows, Node.js 22.16+, Rust 1.90+ (MSVC), Visual Studio Build Tools с рабочей нагрузкой C++, WebView2.

```powershell
cd app
npm ci
npm test
npm run typecheck
npm run tauri dev
npm run installer
```

`npm run tauri dev` открывает окно разработки. `npm run installer` собирает NSIS для текущего пользователя, языки ru/en и тихий загрузчик WebView2.

Рядом собирается `sreda-mcp.exe`. В CI по тегу `v*` он попадает в релиз и в установщик как sidecar.

На Linux CI гоняет тесты интерфейса и `cargo test` библиотеки (нужен WebKitGTK, как в [`.github/workflows/ci.yml`](.github/workflows/ci.yml)). Установщик NSIS собирается на Windows.

## MCP

В приложении: Настройки → ИИ / MCP. Сервер выключен, пока вы его не включите. Режим по умолчанию — только чтение. HTTP слушает только `127.0.0.1` и требует токен. Удаление через ИИ всегда ждёт подтверждения в журнале, оттуда же можно отменить запись.

Кнопка «Скопировать конфиг» даёт фрагмент для Claude Desktop и Cursor. Для stdio:

```json
{
  "mcpServers": {
    "sreda": {
      "command": "C:\\Path\\To\\sreda-mcp.exe"
    }
  }
}
```

Путь подставляет само приложение. Бинарник читает ту же базу, что и окно. Переменная `SREDA_DB` переопределяет путь к файлу SQLite.

## Темы

Файл `*.sreda-theme.json`: имя, автор, версия, база `dark` или `light`, известные токены и необязательный CSS. Санитайзер отклоняет неизвестные токены и значения с `url(`, `@import`, `javascript:`, `expression(` и тегами. Свою тему можно собрать в настройках, перетащить файл в окно или отправить участникам открытой доски.

## Совместная работа

Кнопка «Поделиться» поднимает WebSocket-сервер **только на `127.0.0.1`**. Без ngrok к нему можно подключиться лишь с того же компьютера — другие устройства вашей локальной сети не подключатся. Для удалённых гостей нужен токен ngrok; статический домен необязателен. Без постоянного адреса после перезапуска нужна новая ссылка. Приглашение версии 2 привязано к **одной доске** и роли **просмотр / редактирование**. Гости не получают остальные доски и не могут изменять их через совместную работу. Старые приглашения версии 1 нужно выдать заново.

## Структура

```text
app/                 React, тесты, src-tauri (Rust, SQLite, совместная работа, MCP)
app/src-tauri/       окно приложения и бинарник sreda-mcp
scripts/             сборка интерфейса и локальный выпуск
docs/screenshots/    скриншоты для этого README
.github/             CI, Dependabot, шаблоны issue и pull request
CHANGELOG.md         журнал версий, его же показывает раздел «Обновления»
```

План, который вошёл в 0.3.0, и то, что ещё впереди, — в [app/ROADMAP.md](app/ROADMAP.md). Журнал — в [CHANGELOG.md](CHANGELOG.md). Заметки разработчика по ранним сборкам — в [app/CHANGES.md](app/CHANGES.md).

## Участие

Смотрите [CONTRIBUTING.md](CONTRIBUTING.md). Короткие правки и сообщения об ошибках приветствуются. Вопросы — [обсуждения](https://github.com/ZAREZOV2/sreda/discussions) или [issue](https://github.com/ZAREZOV2/sreda/issues). Как сообщить об уязвимости, не создавая публичный issue: [SECURITY.md](SECURITY.md). Поддержка пользователей: [SUPPORT.md](SUPPORT.md).

## Лицензия

[GPL-3.0-or-later](LICENSE). Шрифты Golos Text и JetBrains Mono поставляются отдельно под [SIL OFL 1.1](app/public/fonts/OFL-GolosText.txt) и не перелицензируются под GPL. Краткие уведомления о библиотеках интерфейса — в [app/THIRD-PARTY-NOTICES.txt](app/THIRD-PARTY-NOTICES.txt).
