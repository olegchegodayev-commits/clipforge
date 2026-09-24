const fileInput = document.querySelector('#file-input');
const dropzone = document.querySelector('#dropzone');
const formatInput = document.querySelector('#format');
const qualityInput = document.querySelector('#quality');
const qualityValue = document.querySelector('#quality-value');
const maxWidthInput = document.querySelector('#max-width');
const convertButton = document.querySelector('#convert');
const downloadAllButton = document.querySelector('#download-all');
const clearButton = document.querySelector('#clear');
const fileList = document.querySelector('#file-list');
const fileCount = document.querySelector('#file-count');
const emptyState = document.querySelector('#empty-state');
const toast = document.querySelector('#toast');
const files = [];
let toastTimer;

function showToast(text) {
  toast.textContent = text;
  toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 3200);
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 ** 2) return `${Math.round(bytes / 1024)} КБ`;
  return `${(bytes / 1024 ** 2).toFixed(1)} МБ`;
}

function baseName(name) {
  return name.replace(/\.[^.]+$/, '').replace(/[^a-zа-яё0-9_-]+/gi, '-').replace(/^-|-$/g, '') || 'image';
}

function updateControls() {
  const converted = files.filter((item) => item.outputBlob).length;
  fileCount.textContent = files.length ? `${files.length} ${files.length === 1 ? 'файл' : files.length < 5 ? 'файла' : 'файлов'}` : 'Нет файлов';
  convertButton.disabled = files.length === 0;
  clearButton.hidden = files.length === 0;
  downloadAllButton.hidden = converted === 0;
  emptyState.hidden = files.length > 0;
}

function renderFiles() {
  fileList.innerHTML = '';
  files.forEach((item) => {
    const row = document.createElement('article');
    row.className = 'file-row';
    row.innerHTML = `<img src="${item.previewUrl}" alt="" /><div class="file-info"><strong>${item.file.name}</strong><span>${item.width} x ${item.height} px · ${formatBytes(item.file.size)}</span></div><div class="file-result">${item.outputBlob ? `<b>${formatBytes(item.outputBlob.size)}</b><span>${item.outputName}</span>` : '<span class="ready">Готов к обработке</span>'}</div><button class="remove-button" aria-label="Удалить файл">×</button>`;
    row.querySelector('.remove-button').addEventListener('click', () => removeFile(item.id));
    fileList.append(row);
  });
  updateControls();
}

function readImage(file) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight, previewUrl: url });
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error(`${file.name}: файл не удалось прочитать`)); };
    image.src = url;
  });
}

async function addFiles(fileListValue) {
  const imageFiles = [...fileListValue].filter((file) => file.type.startsWith('image/'));
  if (!imageFiles.length) return showToast('Выберите изображения');
  for (const file of imageFiles) {
    if (files.some((item) => item.file.name === file.name && item.file.size === file.size)) continue;
    try { files.push({ id: crypto.randomUUID(), file, ...(await readImage(file)) }); } catch (error) { showToast(error.message); }
  }
  renderFiles();
}

function removeFile(id) {
  const index = files.findIndex((item) => item.id === id);
  if (index === -1) return;
  URL.revokeObjectURL(files[index].previewUrl);
  if (files[index].outputUrl) URL.revokeObjectURL(files[index].outputUrl);
  files.splice(index, 1);
  renderFiles();
}

function convertImage(item) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const requestedWidth = Number(maxWidthInput.value) || image.naturalWidth;
      const width = Math.min(image.naturalWidth, Math.max(1, requestedWidth));
      const height = Math.round(image.naturalHeight * (width / image.naturalWidth));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      if (formatInput.value === 'jpeg') { context.fillStyle = '#ffffff'; context.fillRect(0, 0, width, height); }
      context.drawImage(image, 0, 0, width, height);
      const mime = `image/${formatInput.value}`;
      canvas.toBlob((blob) => blob ? resolve({ blob, width, height }) : reject(new Error('Браузер не поддерживает этот формат')), mime, Number(qualityInput.value) / 100);
    };
    image.onerror = () => reject(new Error(`Не удалось обработать ${item.file.name}`));
    image.src = item.previewUrl;
  });
}

async function convertAll() {
  convertButton.disabled = true;
  convertButton.classList.add('loading');
  convertButton.firstChild.textContent = 'Обрабатываем... ';
  for (const item of files) {
    try {
      const result = await convertImage(item);
      if (item.outputUrl) URL.revokeObjectURL(item.outputUrl);
      item.outputBlob = result.blob;
      item.outputUrl = URL.createObjectURL(result.blob);
      item.outputName = `${baseName(item.file.name)}.${formatInput.value}`;
      item.width = result.width;
      item.height = result.height;
    } catch (error) { showToast(error.message); }
  }
  convertButton.disabled = false;
  convertButton.classList.remove('loading');
  convertButton.firstChild.textContent = 'Конвертировать ';
  renderFiles();
  showToast('Готово — файлы обработаны в браузере');
}

function download(item) {
  if (!item.outputUrl) return;
  const link = document.createElement('a');
  link.href = item.outputUrl;
  link.download = item.outputName;
  document.body.append(link);
  link.click();
  link.remove();
}

fileInput.addEventListener('change', (event) => addFiles(event.target.files));
['dragenter', 'dragover'].forEach((eventName) => dropzone.addEventListener(eventName, (event) => { event.preventDefault(); dropzone.classList.add('dragging'); }));
['dragleave', 'drop'].forEach((eventName) => dropzone.addEventListener(eventName, (event) => { event.preventDefault(); dropzone.classList.remove('dragging'); }));
dropzone.addEventListener('drop', (event) => addFiles(event.dataTransfer.files));
qualityInput.addEventListener('input', () => { qualityValue.textContent = qualityInput.value; });
formatInput.addEventListener('change', () => { files.forEach((item) => { item.outputBlob = null; }); renderFiles(); });
convertButton.addEventListener('click', convertAll);
downloadAllButton.addEventListener('click', async () => { if (!files.every((item) => item.outputBlob)) await convertAll(); files.forEach(download); });
clearButton.addEventListener('click', () => { while (files.length) removeFile(files[0].id); });
updateControls();