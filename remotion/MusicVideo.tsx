'use client';

import { AbsoluteFill, Audio, Img, Sequence, Video } from 'remotion';

export type SceneClip = {
  id: string;
  order: number;
  startTime: number;
  duration: number;
  imageKeyframeUrl: string | null;
  videoClipUrl: string | null;
  visualPrompt: string;
};

export interface MusicVideoProps {
  scenes: SceneClip[];
  audioUrl?: string | null;
  fps: number;
}

const FALLBACK_COLORS = ['#0f172a', '#1e293b', '#020617', '#111827'];

export function MusicVideo({ scenes, audioUrl, fps }: MusicVideoProps) {
  const safeFps = fps || 30;

  return (
    <AbsoluteFill className="bg-black">
      {audioUrl ? <Audio src={audioUrl} /> : null}
      {scenes.map((scene) => {
        const from = Math.max(0, Math.round(scene.startTime * safeFps));
        const durationFrames = Math.max(
          1,
          Math.round(scene.duration * safeFps) || safeFps,
        );
        const background =
          FALLBACK_COLORS[scene.order % FALLBACK_COLORS.length];

        return (
          <Sequence
            key={scene.id}
            from={from}
            durationInFrames={durationFrames}
          >
            <AbsoluteFill className="items-center justify-center">
              {scene.videoClipUrl ? (
                <Video
                  src={scene.videoClipUrl}
                  muted
                  startFrom={0}
                  endAt={durationFrames}
                  style={{ objectFit: 'cover', width: '100%', height: '100%' }}
                />
              ) : scene.imageKeyframeUrl ? (
                <Img
                  src={scene.imageKeyframeUrl}
                  style={{ objectFit: 'cover', width: '100%', height: '100%' }}
                />
              ) : (
                <AbsoluteFill
                  style={{
                    background,
                  }}
                />
              )}
              <AbsoluteFill className="bg-gradient-to-t from-black/70 via-transparent to-black/60" />
              <AbsoluteFill className="flex flex-col justify-end p-12 text-white">
                <p className="text-sm uppercase tracking-[0.3em] text-white/70">
                  Scene {scene.order + 1}
                </p>
                <p className="text-3xl font-semibold leading-tight">
                  {scene.visualPrompt}
                </p>
              </AbsoluteFill>
            </AbsoluteFill>
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
}
