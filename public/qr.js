const DATA_CODEWORDS = [0, 19, 34, 55, 80, 108];
const EC_CODEWORDS = [0, 7, 10, 15, 20, 26];

function multiply(a, b) {
  let result = 0;
  while (b) {
    if (b & 1) result ^= a;
    b >>>= 1;
    a <<= 1;
    if (a & 0x100) a ^= 0x11d;
  }
  return result;
}

function remainder(data, degree) {
  let generator = [1];
  for (let i = 0, root = 1; i < degree; i += 1) {
    const next = new Array(generator.length + 1).fill(0);
    for (let j = 0; j < generator.length; j += 1) {
      next[j] ^= generator[j];
      next[j + 1] ^= multiply(generator[j], root);
    }
    generator = next;
    root = multiply(root, 2);
  }
  const work = [...data, ...new Array(degree).fill(0)];
  for (let i = 0; i < data.length; i += 1) {
    const factor = work[i];
    if (!factor) continue;
    for (let j = 0; j < generator.length; j += 1) work[i + j] ^= multiply(generator[j], factor);
  }
  return work.slice(data.length);
}

function appendBits(target, value, length) {
  for (let bit = length - 1; bit >= 0; bit -= 1) target.push((value >>> bit) & 1);
}

function encodeData(text, version) {
  const bytes = Array.from(new TextEncoder().encode(text));
  const capacity = DATA_CODEWORDS[version] * 8;
  const bits = [];
  appendBits(bits, 0b0100, 4);
  appendBits(bits, bytes.length, 8);
  for (const byte of bytes) appendBits(bits, byte, 8);
  if (bits.length > capacity) throw new Error('This QR address is too long. Use a shorter Public base URL in Settings.');
  appendBits(bits, 0, Math.min(4, capacity - bits.length));
  while (bits.length % 8) bits.push(0);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) {
    data.push(bits.slice(i, i + 8).reduce((value, bit) => (value << 1) | bit, 0));
  }
  for (let pad = 0; data.length < DATA_CODEWORDS[version]; pad += 1) data.push(pad % 2 === 0 ? 0xec : 0x11);
  return [...data, ...remainder(data, EC_CODEWORDS[version])];
}

function formatBits(mask) {
  const data = (0b01 << 3) | mask;
  let value = data << 10;
  for (let bit = 14; bit >= 10; bit -= 1) {
    if ((value >>> bit) & 1) value ^= 0x537 << (bit - 10);
  }
  return ((data << 10) | value) ^ 0x5412;
}

export function encodeQR(text) {
  const length = new TextEncoder().encode(text).length;
  const version = DATA_CODEWORDS.findIndex((capacity, index) => index > 0 && length <= (capacity * 8 - 12) / 8);
  if (!version || length > 106) throw new Error('This QR address is too long. Use a shorter Public base URL in Settings.');
  const size = version * 4 + 17;
  const matrix = Array.from({ length: size }, () => new Array(size).fill(false));
  const reserved = Array.from({ length: size }, () => new Array(size).fill(false));
  const setFunction = (x, y, dark) => {
    matrix[y][x] = dark;
    reserved[y][x] = true;
  };

  function drawFinder(centerX, centerY) {
    for (let dy = -4; dy <= 4; dy += 1) {
      for (let dx = -4; dx <= 4; dx += 1) {
        const x = centerX + dx;
        const y = centerY + dy;
        if (x < 0 || y < 0 || x >= size || y >= size) continue;
        const distance = Math.max(Math.abs(dx), Math.abs(dy));
        setFunction(x, y, distance !== 2 && distance !== 4);
      }
    }
  }

  drawFinder(3, 3);
  drawFinder(size - 4, 3);
  drawFinder(3, size - 4);

  for (let i = 8; i < size - 8; i += 1) {
    if (!reserved[6][i]) setFunction(i, 6, i % 2 === 0);
    if (!reserved[i][6]) setFunction(6, i, i % 2 === 0);
  }

  if (version >= 2) {
    const center = [0, 0, 18, 22, 26, 30][version];
    for (const centerY of [center]) {
      for (const centerX of [center]) {
        if (reserved[centerY][centerX]) continue;
        for (let dy = -2; dy <= 2; dy += 1) {
          for (let dx = -2; dx <= 2; dx += 1) {
            const distance = Math.max(Math.abs(dx), Math.abs(dy));
            setFunction(centerX + dx, centerY + dy, distance === 2 || distance === 0);
          }
        }
      }
    }
  }

  const format = formatBits(0);
  for (let i = 0; i <= 5; i += 1) setFunction(8, i, ((format >>> i) & 1) !== 0);
  setFunction(8, 7, ((format >>> 6) & 1) !== 0);
  setFunction(8, 8, ((format >>> 7) & 1) !== 0);
  setFunction(7, 8, ((format >>> 8) & 1) !== 0);
  for (let i = 9; i < 15; i += 1) setFunction(14 - i, 8, ((format >>> i) & 1) !== 0);
  for (let i = 0; i < 8; i += 1) setFunction(size - 1 - i, 8, ((format >>> i) & 1) !== 0);
  for (let i = 8; i < 15; i += 1) setFunction(8, size - 15 + i, ((format >>> i) & 1) !== 0);
  setFunction(8, size - 8, true);

  const codewords = encodeData(text, version);
  const bits = codewords.flatMap((byte) => Array.from({ length: 8 }, (_, bit) => (byte >>> (7 - bit)) & 1));
  let bitIndex = 0;
  let upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right -= 1;
    for (let offset = 0; offset < size; offset += 1) {
      const y = upward ? size - 1 - offset : offset;
      for (let column = 0; column < 2; column += 1) {
        const x = right - column;
        if (reserved[y][x]) continue;
        const bit = bits[bitIndex++] || 0;
        matrix[y][x] = Boolean(bit ^ Number((x + y) % 2 === 0));
      }
    }
    upward = !upward;
  }
  return matrix;
}

export function qrToSvg(matrix, width = 640, margin = 4) {
  const size = matrix.length;
  const view = size + margin * 2;
  const path = [];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (matrix[y][x]) path.push(`M${x + margin},${y + margin}h1v1h-1z`);
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${width}" viewBox="0 0 ${view} ${view}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path d="${path.join('')}" fill="#111827"/></svg>`;
}

export function qrToPng(matrix, pixels = 640, margin = 4) {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  const totalModules = matrix.length + margin * 2;
  const moduleSize = Math.floor(pixels / totalModules);
  const drawingSize = moduleSize * totalModules;
  const offset = Math.floor((pixels - drawingSize) / 2);
  canvas.width = pixels;
  canvas.height = pixels;
  context.fillStyle = '#fff';
  context.fillRect(0, 0, pixels, pixels);
  context.fillStyle = '#111827';
  matrix.forEach((row, y) => row.forEach((dark, x) => {
    if (dark) context.fillRect(offset + (x + margin) * moduleSize, offset + (y + margin) * moduleSize, moduleSize, moduleSize);
  }));
  return canvas.toDataURL('image/png');
}
