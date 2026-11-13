import multer from 'multer';
import { LedgerError } from '../ledger/errors.js';

const MAX_BYTES = 5 * 1024 * 1024;
const signatures = {
  'application/pdf': Buffer.from('%PDF-'),
  'image/png': Buffer.from('89504e470d0a1a0a', 'hex'),
  'image/jpeg': Buffer.from('ffd8ff', 'hex'),
};
const mediaError = () => new LedgerError(415, 'UPLOAD_TYPE', 'Select a valid PDF, PNG, or JPEG invoice.');
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES + 1, files: 1, fields: 0 },
  fileFilter: (_req, file, callback) => callback(Object.hasOwn(signatures, file.mimetype) ? null : mediaError(), true),
}).single('invoice');

export function readInvoiceUpload(req, res, next) {
  if (!req.is('multipart/form-data')) return next(new LedgerError(415, 'UPLOAD_TYPE', 'Send one invoice as a multipart upload.'));
  if (Number(req.get('content-length')) > MAX_BYTES + 8192) {
    return next(new LedgerError(413, 'UPLOAD_SIZE', 'Invoice files must be 5 MiB or smaller.'));
  }
  upload(req, res, (error) => {
    if (error?.code === 'LIMIT_FILE_SIZE' || req.file?.size > MAX_BYTES) {
      return next(new LedgerError(413, 'UPLOAD_SIZE', 'Invoice files must be 5 MiB or smaller.'));
    }
    if (error instanceof LedgerError) return next(error);
    if (error || !req.file) return next(new LedgerError(400, 'UPLOAD_REQUIRED', 'Attach one invoice file.'));
    const { buffer, mimetype } = req.file;
    const signature = signatures[mimetype];
    if (!buffer.subarray(0, signature.length).equals(signature) || buffer.length <= signature.length) return next(mediaError());
    return next();
  });
}
