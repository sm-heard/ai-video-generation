import { NextResponse } from 'next/server';

import { uploadAudio } from '@/lib/storage';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const formData = await request.formData();
  const file = formData.get('file');

  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: 'Missing audio file payload.' },
      { status: 400 },
    );
  }

  try {
    const extension = file.name?.split('.').pop();
    const uploadResult = await uploadAudio(file, {
      contentType: file.type || 'audio/mpeg',
      extension,
    });

    return NextResponse.json({ audioUrl: uploadResult.url });
  } catch (error) {
    console.error('[upload-audio]', error);
    return NextResponse.json(
      { error: 'Failed to upload audio. Please try again.' },
      { status: 500 },
    );
  }
}
