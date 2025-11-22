import { put, type PutBlobResult } from '@vercel/blob';
import { randomUUID } from 'node:crypto';

type AssetPayload =
  | File
  | Blob
  | Buffer
  | ArrayBuffer
  | ReadableStream<Uint8Array>;

type UploadKind = 'audio' | 'images' | 'videos';

interface UploadOptions {
  contentType?: string;
  extension?: string;
  access?: 'public' | 'private';
}

const DEFAULT_EXTENSIONS: Record<UploadKind, string> = {
  audio: 'mp3',
  images: 'png',
  videos: 'mp4',
};

async function uploadAsset(
  kind: UploadKind,
  payload: AssetPayload,
  options: UploadOptions = {},
): Promise<PutBlobResult> {
  const access = options.access ?? 'public';
  const extension =
    options.extension ??
    (options.contentType?.split('/')[1] ?? DEFAULT_EXTENSIONS[kind]);
  const id = randomUUID();
  const filename = `${kind}/${new Date()
    .toISOString()
    .replace(/[:.]/g, '-')}-${id}${extension ? `.${extension}` : ''}`;

  return put(filename, payload, {
    access,
    contentType: options.contentType,
  });
}

export async function uploadAudio(
  payload: AssetPayload,
  options: UploadOptions = {},
) {
  return uploadAsset('audio', payload, {
    contentType: 'audio/mpeg',
    ...options,
  });
}

export async function uploadImage(
  payload: AssetPayload,
  options: UploadOptions = {},
) {
  return uploadAsset('images', payload, {
    contentType: 'image/png',
    ...options,
  });
}

export async function uploadVideo(
  payload: AssetPayload,
  options: UploadOptions = {},
) {
  return uploadAsset('videos', payload, {
    contentType: 'video/mp4',
    ...options,
  });
}
