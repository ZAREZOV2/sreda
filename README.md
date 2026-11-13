# Среда

<p align="center">
  <img src="docs/banner.png" alt="Среда — всё под рукой. Локально, приватно и спокойно." width="100%" />
</p>

Локальные канбан-доски и Markdown-документы для Windows и Linux. Доски, документы, темы и база SQLite остаются на вашем компьютере. Совместная работа — по ссылке-приглашению. MCP для ИИ выключен, пока вы сами его не включите.

[![CI](https://github.com/ZAREZOV2/sreda/actions/workflows/ci.yml/badge.svg)](https://github.com/ZAREZOV2/sreda/actions/workflows/ci.yml)
[![Релиз](https://img.shields.io/github/v/release/ZAREZOV2/sreda?label=%D1%80%D0%B5%D0%BB%D0%B8%D0%B7)](https://github.com/ZAREZOV2/sreda/releases/latest)
[![Лицензия GPL-3.0](https://img.shields.io/badge/license-GPL--3.0--or--later-blue)](LICENSE)
[![Платформа Windows и Linux](https://img.shields.io/badge/platform-Windows%20x64%20%C2%B7%20Linux%20x64-lightgrey)](#установка)
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

### Windows

Нужен Windows x64. Скачайте [Sreda_0.3.0_x64-setup.exe](https://github.com/ZAREZOV2/sreda/releases/download/v0.3.0/Sreda_0.3.0_x64-setup.exe) со [страницы релиза v0.3.0](https://github.com/ZAREZOV2/sreda/releases/tag/v0.3.0). В списке файлов установщик подписан как «Среда_0.3.0_x64-setup.exe», само имя файла — `Sreda_0.3.0_x64-setup.exe`. Рядом лежит `sreda-mcp.exe`: он уже входит в установщик, отдельный файл нужен только если MCP подключаете без окна приложения.

WebView2 установщик скачает сам, если его ещё нет. Данные остаются в `%LOCALAPPDATA%\local.sreda.kanban`.

### Linux

Начиная со следующего релиза по тегу `v*` на той же странице релиза лежат AppImage, пакеты `.deb` и `.rpm` и бинарник `sreda-mcp` для Linux x64. Сборка идёт на Ubuntu 22.04, чтобы glibc был достаточно старым и пакет открывался на Arch и CachyOS.

AppImage — самый прямой путь на Arch и CachyOS. Скачайте файл `Sreda_*_amd64.AppImage`, отметьте его исполняемым и запустите. Нужны FUSE 2 и WebKitGTK 4.1:

```bash
chmod +x Sreda_*_amd64.AppImage
# Arch и CachyOS
sudo pacman -S --needed fuse2 webkit2gtk-4.1 gtk3 librsvg
./Sreda_*_amd64.AppImage
```

Debian и Ubuntu: `sudo apt install ./Sreda_*_amd64.deb`. Зависимости пакета — `libwebkit2gtk-4.1-0`, GTK 3, `libayatana-appindicator3-1` (или `libappindicator3-1`) и `librsvg2-2`. Fedora и другие rpm-системы: `sudo dnf install ./Sreda-*.rpm` (`webkit2gtk4.1`, `gtk3`, `libappindicator-gtk3`, `librsvg2`).

Диалоги открытия файлов идут через портал рабочего стола (`xdg-desktop-portal`): на CachyOS и обычном Arch с KDE или GNOME он уже есть. Совместная работа через ngrok использует тот же Rust-клиент, что и на Windows, отдельный бинарник ngrok не нужен. Данные лежат в `$XDG_DATA_HOME/local.sreda.kanban`, а если переменная не задана — в `~/.local/share/local.sreda.kanban`. Sidecar MCP после установки называется `sreda-mcp` и лежит рядом с программой, без суффикса целевой тройки.

Черновик Linux-сборки можно скачать артефактом `linux-bundles` у проверки pull request, не дожидаясь тега.

## Сборка из исходников

Node.js 22.16+ и Rust 1.90+.

Windows: MSVC, Visual Studio Build Tools с рабочей нагрузкой C++, WebView2.

```powershell
cd app
npm ci
npm test
npm run typecheck
npm run tauri dev
npm run installer
```

`npm run tauri dev` открывает окно разработки. `npm run installer` собирает NSIS для текущего пользователя, языки ru/en и тихий загрузчик WebView2. Рядом собирается `sreda-mcp.exe`. В CI по тегу `v*` он попадает в релиз и в установщик как sidecar: файл в репозитории называется `sreda-mcp-x86_64-pc-windows-msvc.exe`, в установке — `sreda-mcp.exe`.

Linux, Debian и Ubuntu:

```bash
sudo apt-get update
sudo apt-get install -y libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev patchelf libssl-dev pkg-config build-essential libdbus-1-dev file
cd app
npm ci
npm test
npm run typecheck
npm run tauri dev
```

Если `libayatana-appindicator3-dev` нет, поставьте `libappindicator3-dev`. Пакеты AppImage, deb и rpm: соберите `sreda-mcp`, положите его как `src-tauri/binaries/sreda-mcp-$(rustc -vV | sed -n 's/^host: //p')` и запустите `npm run bundle:linux`. На Arch и CachyOS те же библиотеки ставятся так:

```bash
sudo pacman -S --needed webkit2gtk-4.1 gtk3 libayatana-appindicator librsvg base-devel openssl pkgconf dbus
```

Если пакета `libayatana-appindicator` нет, подойдёт `libappindicator-gtk3`. CI собирает те же пакеты на Ubuntu 22.04 и по тегу `v*` кладёт их в релиз рядом с установщиком Windows.

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

На Linux тот же фрагмент с путём к `sreda-mcp` без `.exe`. Путь подставляет само приложение. Бинарник читает ту же базу, что и окно. Переменная `SREDA_DB` переопределяет путь к файлу SQLite.

## Темы

Файл `*.sreda-theme.json`: имя, автор, версия, база `dark` или `light`, известные токены и необязательный CSS. Санитайзер отклоняет неизвестные токены и значения с `url(`, `@import`, `javascript:`, `expression(` и тегами. Свою тему можно собрать в настройках, перетащить файл в окно или отправить участникам открытой доски.

## Совместная работа

Кнопка «Поделиться» поднимает локальный WebSocket. Токен ngrok и статический домен необязательны: без них гости в вашей сети подключаются по локальному адресу, а после перезапуска без статического домена нужна новая ссылка. Доска узнаётся по `workspaceId` и `hostId`. Токен приглашения хранится только у хозяина доски.

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
