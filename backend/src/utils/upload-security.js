import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import multer from 'multer';
import { config } from '../config.js';

const DANGEROUS_EXTENSIONS = new Set([
  '.exe', '.bat', '.cmd', '.sh', '.ps1', '.php', '.phtml', '.jsp', '.asp', '.aspx',
  '.js', '.mjs', '.cjs', '.ts', '.vbs', '.hta', '.html', '.htm', '.svg', '.xml', '.xlsm', '.docm', '.pptm',
]);

const MAGIC = {
  '.pdf': [[0x25, 0x50, 0x44, 0x46]],
  '.png': [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  '.jpg': [[0xff, 0xd8, 0xff]],
  '.jpeg': [[0xff, 0xd8, 0xff]],
  '.gif': [[0x47, 0x49, 0x46, 0x38]],
  '.webp': [[0x52, 0x49, 0x46, 0x46]],
  '.bmp': [[0x42, 0x4d]],
  '.zip': [[0x50, 0x4b, 0x03, 0x04], [0x50, 0x4b, 0x05, 0x06], [0x50, 0x4b, 0x07, 0x08]],
  '.docx': [[0x50, 0x4b, 0x03, 0x04]],
  '.xlsx': [[0x50, 0x4b, 0x03, 0x04]],
};

function extensionOf(file) {
  return path.extname(file?.originalname || '').toLowerCase();
}

export function validateUpload(file, allowedKinds = ['pdf', 'image', 'document'], checkBuffer = true) {
  if (checkBuffer && !file?.buffer) return 'Fichier requis';
  const ext = extensionOf(file);
  if (!ext || DANGEROUS_EXTENSIONS.has(ext)) return 'Type de fichier non autorisé';
  const images = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'];
  const videos = ['.mp4', '.webm', '.mov', '.avi', '.mkv', '.m4v', '.3gp'];
  const documents = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.csv', '.zip', '.rar', '.7z', '.mp4', '.webm', '.mov', '.avi', '.mkv', '.m4v', '.3gp', '.glb', '.gltf', '.obj', '.fbx', '.stl', '.3ds', '.dae', '.ifc', '.dwg', '.dxf', '.skp', '.step', '.stp', '.ply'];
  const allowedExts = new Set([
    ...(allowedKinds.includes('pdf') ? ['.pdf'] : []),
    ...(allowedKinds.includes('image') ? images : []),
    ...(allowedKinds.includes('video') ? videos : []),
    ...(allowedKinds.includes('document') ? documents : []),
  ]);
  if (!allowedExts.has(ext)) return 'Type de fichier non autorisé';
  if (!checkBuffer) return null;
  const signatures = MAGIC[ext];
  if (signatures) {
    const ok = signatures.some(sig => file.buffer.length >= sig.length && file.buffer.subarray(0, sig.length).equals(Buffer.from(sig)));
    if (!ok) return 'Le contenu du fichier ne correspond pas à son extension';
    if (ext === '.webp' && !(file.buffer.length >= 12 && file.buffer.subarray(8, 12).toString('ascii') === 'WEBP')) {
      return 'Le contenu du fichier ne correspond pas à son extension';
    }
  } else if (['image', 'pdf'].some(k => allowedKinds.includes(k)) && ['.pdf', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'].includes(ext)) {
    return 'Signature de fichier non reconnue';
  }
  return null;
}

export function createUpload({ kinds = ['pdf', 'image', 'document'], maxBytes = 20 * 1024 * 1024 } = {}) {
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxBytes, files: 1, fields: 30 },
    fileFilter: (req, file, cb) => {
      const error = validateUpload(file, kinds, false);
      if (error) {
        const err = new Error(error);
        err.status = 400;
        return cb(err);
      }
      return cb(null, true);
    },
  });
}

export async function persistUpload(file, prefix) {
  const error = validateUpload(file);
  if (error) throw Object.assign(new Error(error), { status: 400 });
  const ext = extensionOf(file) || '.bin';
  const safePrefix = String(prefix || 'file').replace(/[^a-zA-Z0-9_-]/g, '');
  const storedName = `${safePrefix}-${Date.now()}-${crypto.randomUUID()}${ext}`;
  await fs.writeFile(path.join(path.resolve(config.uploadDir), storedName), file.buffer);
  file.storedName = storedName;
  return storedName;
}

export function safeStoredName(value) {
  const name = path.basename(String(value || ''));
  if (!name || name !== String(value) || name.includes('..')) return null;
  return name;
}

export function uploadPath(storedName) {
  const safe = safeStoredName(storedName);
  return safe ? path.join(path.resolve(config.uploadDir), safe) : null;
}
