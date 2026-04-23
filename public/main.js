const MAX_SIZE = 5 * 1024 * 1024;
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'application/pdf']);

const useCameraBtn = document.getElementById('useCameraBtn');
const captureBtn = document.getElementById('captureBtn');
const extractBtn = document.getElementById('extractBtn');
const fileInput = document.getElementById('fileInput');
const videoPreview = document.getElementById('videoPreview');
const captureCanvas = document.getElementById('captureCanvas');
const previewImage = document.getElementById('previewImage');
const previewLabel = document.getElementById('previewLabel');
const spinner = document.getElementById('spinner');
const errorMsg = document.getElementById('errorMsg');
const resultText = document.getElementById('resultText');
const metaTimestamp = document.getElementById('metaTimestamp');
const metaFileName = document.getElementById('metaFileName');

let currentFile = null;
let mediaStream = null;

function setError(message = '') {
  errorMsg.textContent = message;
}

function resetMetadata() {
  metaTimestamp.textContent = '-';
  metaFileName.textContent = '-';
}

function setCurrentFile(file) {
  currentFile = file;
  extractBtn.disabled = !file;
  resetMetadata();

  if (!file) {
    previewImage.style.display = 'none';
    previewLabel.textContent = 'No file selected.';
    return;
  }

  if (file.type === 'application/pdf') {
    previewImage.style.display = 'none';
    previewLabel.textContent = `PDF selected: ${file.name}`;
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    const imageDataUrl = String(reader.result || '');
    const isSafeDataUrl =
      imageDataUrl.startsWith('data:image/jpeg;base64,') ||
      imageDataUrl.startsWith('data:image/png;base64,');

    if (!isSafeDataUrl) {
      setCurrentFile(null);
      setError('Unsupported image preview format.');
      return;
    }

    previewImage.src = imageDataUrl;
    previewImage.style.display = 'block';
    previewLabel.textContent = file.name;
  };

  reader.onerror = () => {
    setCurrentFile(null);
    setError('Unable to preview this file.');
  };

  reader.readAsDataURL(file);
}

function validateFile(file) {
  if (!file) {
    return 'Please select a file.';
  }
  if (!ALLOWED_TYPES.has(file.type)) {
    return 'Unsupported file type. Please use JPG, PNG, or PDF.';
  }
  if (file.size > MAX_SIZE) {
    return 'File is too large. Maximum size is 5MB.';
  }
  return '';
}

async function stopCamera() {
  if (mediaStream) {
    mediaStream.getTracks().forEach((track) => track.stop());
    mediaStream = null;
  }
  videoPreview.style.display = 'none';
  captureBtn.disabled = true;
}

useCameraBtn.addEventListener('click', async () => {
  setError('');

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    setError('Camera is not supported in this browser.');
    return;
  }

  try {
    await stopCamera();
    mediaStream = await navigator.mediaDevices.getUserMedia({ video: true });
    videoPreview.srcObject = mediaStream;
    videoPreview.style.display = 'block';
    captureBtn.disabled = false;
  } catch (error) {
    setError('Unable to access camera. Please check permissions and try again.');
  }
});

captureBtn.addEventListener('click', async () => {
  if (!mediaStream) return;

  const trackSettings = mediaStream.getVideoTracks()[0]?.getSettings() || {};
  const width = trackSettings.width || 1280;
  const height = trackSettings.height || 720;

  captureCanvas.width = width;
  captureCanvas.height = height;

  const context = captureCanvas.getContext('2d');
  context.drawImage(videoPreview, 0, 0, width, height);

  captureCanvas.toBlob(async (blob) => {
    if (!blob) {
      setError('Could not capture image. Please try again.');
      return;
    }

    const file = new File([blob], `camera-capture-${Date.now()}.png`, { type: 'image/png' });
    const validationError = validateFile(file);
    if (validationError) {
      setError(validationError);
      return;
    }

    setCurrentFile(file);
    await stopCamera();
  }, 'image/png');
});

fileInput.addEventListener('change', async (event) => {
  setError('');
  await stopCamera();

  const [file] = event.target.files || [];
  const validationError = validateFile(file);
  if (validationError) {
    setCurrentFile(null);
    setError(validationError);
    return;
  }

  setCurrentFile(file);
});

extractBtn.addEventListener('click', async () => {
  setError('');
  resultText.value = '';

  const validationError = validateFile(currentFile);
  if (validationError) {
    setError(validationError);
    return;
  }

  const formData = new FormData();
  formData.append('file', currentFile);

  spinner.style.display = 'block';
  extractBtn.disabled = true;

  try {
    const response = await fetch('/api/ocr/extract', {
      method: 'POST',
      body: formData
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Could not extract text.');
    }

    resultText.value = data.text || '';
    metaTimestamp.textContent = data.metadata?.timestamp || '-';
    metaFileName.textContent = data.metadata?.fileName || '-';

    if (!data.text || !data.text.trim()) {
      setError('No readable text found. Please upload a clearer, well-lit image.');
    }
  } catch (error) {
    setError(error.message || 'OCR failed. Please try again.');
  } finally {
    spinner.style.display = 'none';
    extractBtn.disabled = !currentFile;
  }
});
