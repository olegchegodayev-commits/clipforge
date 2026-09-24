# ClipForge

Локальный интерфейс для сохранения видео с YouTube с выбором разрешения. Используйте только материалы, на которые у вас есть права или разрешение автора.

## Запуск

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe server.py
```

Откройте <http://localhost:3000>.

## Production

Сборка не требуется: это Python web service со статическими файлами в `public/`.

```bash
pip install -r requirements.txt
python server.py
```

Сервер использует переменные `HOST` и `PORT`; на production-платформе он слушает `0.0.0.0` и переданный `PORT`. Конфигурация Render находится в `render.yaml`.

Бесплатный тариф подходит только для небольших личных нагрузок: сервис может засыпать, а длительные скачивания и большие файлы могут упираться в лимиты платформы. Используйте только контент, на который у вас есть права.