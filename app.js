const urlInput = document.querySelector('#url');
const analyzeButton = document.querySelector('#analyze');
const clearButton = document.querySelector('#clear');
const message = document.querySelector('#message');
const result = document.querySelector('#result');
const quality = document.querySelector('#quality');
const downloadButton = document.querySelector('#download');
const activeDownloads = document.querySelector('#active-downloads');
const historyPanel = document.querySelector('#history-panel');
const historyList = document.querySelector('#history-list');
const toast = document.querySelector('#toast');
let currentUrl = '';
let currentData = null;
let toastTimer;

function showMessage(text = '') { message.textContent = text; }
function showToast(text) { toast.textContent = text; toast.classList.add('visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove('visible'), 3200); }
function currentSize() { return Number(currentData?.size_bytes?.[quality.value] || 0); }
function getHistory() { return JSON.parse(localStorage.getItem('clipforge-history') || '[]'); }
function renderHistory() { const items = getHistory(); historyPanel.classList.toggle('hidden', items.length === 0); historyList.innerHTML = items.map((item) => `<div class="history-item"><strong>${item.title}</strong><span>${item.quality}p · ${item.size} · ${item.date}</span></div>`).join(''); }
function addHistory(item) { const items = [{ ...item, date: new Date().toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) }, ...getHistory()].slice(0, 12); localStorage.setItem('clipforge-history', JSON.stringify(items)); renderHistory(); }

async function downloadItem(item) {
  const card = document.createElement('div');
  card.className = 'download-card';
  card.innerHTML = `<div class="download-card-header"><strong>${item.title}</strong><button class="close-download" aria-label="Закрыть">×</button></div><ol class="download-steps"><li class="active">Проверяем формат видео</li><li>Готовим видео и звук</li><li>Подготавливаем файл</li><li>Передаём в браузер</li></ol><div class="download-status">Процесс идёт. Не закрывайте страницу.</div><div class="progress-track"><div class="progress-fill indeterminate" style="width:100%"></div><span class="progress-message">Проверяем формат видео...</span><span class="progress-elapsed">Прошло 00:00</span><span class="progress-label">Подготовка</span></div><button class="cancel-button">Отменить</button>`;
  activeDownloads.prepend(card);
  const status = card.querySelector('.download-status');
  const steps = [...card.querySelectorAll('.download-steps li')];
  const elapsedLabel = card.querySelector('.progress-elapsed');
  const fill = card.querySelector('.progress-fill');
  const label = card.querySelector('.progress-label');
  const progressMessage = card.querySelector('.progress-message');
  const cancel = card.querySelector('.cancel-button');
  const close = card.querySelector('.close-download');
  const controller = new AbortController();
  const startedAt = Date.now(); let preparationStep = 0;
  const elapsedTimer = setInterval(() => {
    const elapsed = Math.floor((Date.now() - startedAt) / 1000);
    elapsedLabel.textContent = `Прошло ${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`;
    preparationStep = Math.min(2, Math.floor(elapsed / 3)); steps.forEach((step, index) => step.classList.toggle('active', index === preparationStep)); progressMessage.textContent = `${steps[preparationStep].textContent}...`;
  }, 1000);
  close.addEventListener('click', () => card.remove());
  cancel.addEventListener('click', () => { cancel.disabled = true; status.textContent = 'Отмена...'; controller.abort(); });
  try {
    const response = await fetch(`/api/download?url=${encodeURIComponent(item.url)}&quality=${item.quality}`, { signal: controller.signal });
    if (!response.ok) throw new Error('Не удалось скачать файл.');
    steps.forEach((step, index) => step.classList.toggle('active', index === 3));
    status.textContent = 'Скачивание идёт. Не закрывайте страницу.'; progressMessage.textContent = 'Файл передаётся в браузер';
    const total = Number(response.headers.get('Content-Length'));
    const reader = response.body.getReader();
    const chunks = [];
    let received = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
      if (total) {
        const percent = Math.round((received / total) * 100);
        fill.classList.remove('indeterminate'); fill.style.width = `${percent}%`; label.textContent = `${percent}%`;
      }
    }
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob(chunks, { type: 'video/mp4' }));
    link.download = `${item.title.replace(/[\\/:*?"<>|]/g, '').slice(0, 80) || 'clipforge-video'}.mp4`;
    link.click(); URL.revokeObjectURL(link.href);
    steps.forEach((step) => step.classList.remove('active')); progressMessage.textContent = 'Файл готов'; fill.classList.remove('indeterminate'); fill.style.width = '100%'; label.textContent = '100%'; status.textContent = 'Видео сохранено и готово к просмотру.'; cancel.remove(); addHistory(item); showToast('Скачивание завершено');
  } catch (error) {
    if (error.name === 'AbortError') { progressMessage.textContent = 'Скачивание отменено'; status.textContent = 'Процесс остановлен пользователем.'; fill.classList.remove('indeterminate'); fill.style.width = '0%'; label.textContent = 'Отменено'; cancel.remove(); showToast('Скачивание отменено'); }
    else { status.textContent = error.message; showToast(error.message); }
  } finally { clearInterval(elapsedTimer); }
}

clearButton.addEventListener('click', () => { urlInput.value = ''; currentData = null; result.classList.add('hidden'); showMessage(); urlInput.focus(); });
analyzeButton.addEventListener('click', async () => {
  const url = urlInput.value.trim();
  if (!url) return showMessage('Сначала вставьте ссылку на видео.');
  analyzeButton.disabled = true; analyzeButton.firstChild.textContent = 'Проверяем... '; showMessage();
  try {
    const response = await fetch('/api/info', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) });
    const contentType = response.headers.get('content-type') || '';
    const data = contentType.includes('application/json') ? await response.json() : { error: 'Эта бесплатная статическая версия содержит только интерфейс. Для анализа видео нужен запущенный backend.' };
    if (!response.ok) throw new Error(data.error);
    currentUrl = url; currentData = data; document.querySelector('#thumbnail').src = data.thumbnail; document.querySelector('#title').textContent = data.title; document.querySelector('#channel').textContent = data.channel || 'YouTube'; document.querySelector('#duration').textContent = data.duration || '—';
    quality.innerHTML = data.heights.map((height) => `<option value="${height}">${height}p · ${data.sizes?.[height] || 'размер уточняется'}</option>`).reverse().join(''); result.classList.remove('hidden');
  } catch (error) { result.classList.add('hidden'); showMessage(error.message || 'Не удалось проверить ссылку.'); }
  finally { analyzeButton.disabled = false; analyzeButton.firstChild.textContent = 'Проверить '; }
});
downloadButton.addEventListener('click', () => { if (currentData) downloadItem({ url: currentUrl, title: currentData.title, quality: quality.value, size: currentData.sizes?.[quality.value] || '—', sizeBytes: currentSize() }); });
document.querySelector('#clear-history').addEventListener('click', () => { localStorage.removeItem('clipforge-history'); renderHistory(); showToast('История очищена'); });
urlInput.addEventListener('keydown', (event) => { if (event.key === 'Enter') analyzeButton.click(); });
renderHistory();
