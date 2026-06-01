import { Router, Request, Response } from 'express';
import multer from 'multer';
import { S3Client, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import multerS3 from 'multer-s3';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import pool from '../utils/db';
import { authenticate, requireActiveSubscription } from '../middleware/auth';

const router = Router();

// ─── Configuration S3 ─────────────────────────────────────────
const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'eu-west-3',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

const BUCKET = process.env.AWS_BUCKET_NAME!;
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/gif'];
const MAX_SIZE_MB = parseInt(process.env.MAX_FILE_SIZE_MB || '50');

// ─── Multer + S3 ──────────────────────────────────────────────
const upload = multer({
  storage: multerS3({
    s3: s3Client,
    bucket: BUCKET,
    metadata: (req, file, cb) => {
      cb(null, { fieldName: file.fieldname, uploadedBy: (req as any).user.id });
    },
    key: (req, file, cb) => {
      const userId = (req as any).user.id;
      const ext = path.extname(file.originalname).toLowerCase();
      const key = `photos/${userId}/${uuidv4()}${ext}`;
      cb(null, key);
    },
    contentType: multerS3.AUTO_CONTENT_TYPE,
  }),
  fileFilter: (req, file, cb) => {
    if (ALLOWED_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Type de fichier non autorisé: ${file.mimetype}`));
    }
  },
  limits: {
    fileSize: MAX_SIZE_MB * 1024 * 1024,
    files: 20, // max 20 fichiers par requête
  },
});

// ─── GET /api/photos ──────────────────────────────────────────
router.get('/', authenticate, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { page = 1, limit = 50 } = req.query;

  try {
    const offset = (Number(page) - 1) * Number(limit);

    const result = await pool.query(
      `SELECT id, filename, original_name, mime_type, size_bytes, width, height, created_at, metadata
       FROM photos
       WHERE user_id = $1 AND is_deleted = false
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, Number(limit), offset]
    );

    const countResult = await pool.query(
      'SELECT COUNT(*) FROM photos WHERE user_id = $1 AND is_deleted = false',
      [userId]
    );

    // Générer les URLs présignées (valides 1h)
    const photosWithUrls = await Promise.all(result.rows.map(async (photo) => {
      const url = await getSignedUrl(s3Client, new GetObjectCommand({
        Bucket: BUCKET,
        Key: photo.s3_key || `photos/${userId}/${photo.filename}`,
      }), { expiresIn: 3600 });

      return {
        id: photo.id,
        filename: photo.original_name,
        mimeType: photo.mime_type,
        sizeBytes: photo.size_bytes,
        sizeMB: (photo.size_bytes / 1024 / 1024).toFixed(1),
        width: photo.width,
        height: photo.height,
        url,
        createdAt: photo.created_at,
      };
    }));

    res.json({
      photos: photosWithUrls,
      total: parseInt(countResult.rows[0].count),
      page: Number(page),
      pages: Math.ceil(parseInt(countResult.rows[0].count) / Number(limit)),
    });
  } catch (err) {
    console.error('Erreur récupération photos:', err);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
});

// ─── POST /api/photos/upload ──────────────────────────────────
router.post('/upload',
  authenticate,
  requireActiveSubscription,
  upload.array('photos', 20),
  async (req: Request, res: Response) => {
    const userId = (req as any).user.id;
    const files = req.files as Express.MulterS3.File[];

    if (!files || files.length === 0) {
      return res.status(400).json({ message: 'Aucun fichier reçu.' });
    }

    try {
      const uploadedPhotos = await Promise.all(files.map(async (file) => {
        const result = await pool.query(
          `INSERT INTO photos (user_id, filename, original_name, mime_type, size_bytes, s3_key, s3_url)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING id, original_name, size_bytes, created_at`,
          [
            userId,
            file.key.split('/').pop(),
            file.originalname,
            file.mimetype,
            file.size,
            file.key,
            file.location,
          ]
        );
        return result.rows[0];
      }));

      res.status(201).json({
        message: `${uploadedPhotos.length} photo(s) importée(s) avec succès`,
        photos: uploadedPhotos,
      });
    } catch (err) {
      console.error('Erreur upload photos:', err);
      res.status(500).json({ message: 'Erreur lors de l\'enregistrement des photos.' });
    }
  }
);

// ─── DELETE /api/photos/:id ───────────────────────────────────
router.delete('/:id', authenticate, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { id } = req.params;

  try {
    // Vérifier que la photo appartient à l'utilisateur
    const result = await pool.query(
      'SELECT id, s3_key FROM photos WHERE id = $1 AND user_id = $2 AND is_deleted = false',
      [id, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Photo introuvable.' });
    }

    const photo = result.rows[0];

    // Supprimer de S3
    await s3Client.send(new DeleteObjectCommand({
      Bucket: BUCKET,
      Key: photo.s3_key,
    }));

    // Soft delete en base
    await pool.query(
      'UPDATE photos SET is_deleted = true, updated_at = NOW() WHERE id = $1',
      [id]
    );

    res.json({ message: 'Photo supprimée avec succès.' });
  } catch (err) {
    console.error('Erreur suppression photo:', err);
    res.status(500).json({ message: 'Erreur lors de la suppression.' });
  }
});

// ─── GET /api/photos/storage ──────────────────────────────────
router.get('/storage', authenticate, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;

  try {
    const result = await pool.query(
      `SELECT 
        COUNT(*) as photo_count,
        COALESCE(SUM(size_bytes), 0) as total_bytes
       FROM photos WHERE user_id = $1 AND is_deleted = false`,
      [userId]
    );

    const { photo_count, total_bytes } = result.rows[0];

    res.json({
      photoCount: parseInt(photo_count),
      totalBytes: parseInt(total_bytes),
      totalMB: (parseInt(total_bytes) / 1024 / 1024).toFixed(2),
      totalGB: (parseInt(total_bytes) / 1024 / 1024 / 1024).toFixed(3),
    });
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur.' });
  }
});

export default router;
