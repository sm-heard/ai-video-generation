'use client';

import { useCallback, useMemo, useState } from 'react';
import { Loader2, Music4 } from 'lucide-react';
import { useRouter } from 'next/navigation';

const stylePresets = [
  { value: 'dreamy_pastel', label: 'Dreamy pastel nature' },
  { value: 'graffiti_energy', label: 'High-energy graffiti city' },
  { value: 'minimalist_cinematic', label: 'Minimalist cinematic' },
] as const;

const energyOptions = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
] as const;

type StylePresetValue = (typeof stylePresets)[number]['value'];
type EnergyValue = (typeof energyOptions)[number]['value'];

type AudioAnalysis = {
  duration: number;
  tempo: number;
  beats: number[];
  trimmed: boolean;
};

const MAX_DURATION_SECONDS = 60;

export default function Home() {
  const router = useRouter();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [prompt, setPrompt] = useState('');
  const [stylePreset, setStylePreset] = useState<StylePresetValue>(stylePresets[0].value);
  const [energy, setEnergy] = useState<EnergyValue>('medium');
  const [analysis, setAnalysis] = useState<AudioAnalysis | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const canSubmit = useMemo(() => {
    return (
      !!selectedFile &&
      !!analysis &&
      prompt.trim().length >= 5 &&
      !isAnalyzing &&
      !isSubmitting
    );
  }, [analysis, isAnalyzing, isSubmitting, prompt, selectedFile]);

  const analyzeAudio = useCallback(async (file: File) => {
    setIsAnalyzing(true);
    setErrorMessage(null);
    try {
      const [{ Input, BlobSource, ALL_FORMATS }, { analyze }] = await Promise.all([
        import('mediabunny'),
        import('web-audio-beat-detector'),
      ]);

      const input = new Input({
        source: new BlobSource(file),
        formats: ALL_FORMATS,
      });

      const duration = await input.computeDuration();
      input.dispose();

      const AudioContextClass =
        window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextClass) {
        throw new Error('Web Audio API is not supported in this browser.');
      }

      const audioContext = new AudioContextClass();
      const arrayBuffer = await file.arrayBuffer();
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));
      const tempo = await analyze(audioBuffer);
      await audioContext.close();

      const beatInterval = 60 / tempo;
      const beats: number[] = [];
      for (let t = 0; t <= duration; t += beatInterval) {
        beats.push(Number(t.toFixed(3)));
      }

      const trimmed = duration > MAX_DURATION_SECONDS;
      const effectiveDuration = Math.min(duration, MAX_DURATION_SECONDS);
      const trimmedBeats = beats.filter((t) => t <= effectiveDuration);

      setAnalysis({
        duration: Number(effectiveDuration.toFixed(2)),
        tempo: Number(tempo.toFixed(2)),
        beats: trimmedBeats,
        trimmed,
      });
    } catch (error) {
      console.error('audio-analysis', error);
      setAnalysis(null);
      setErrorMessage('Unable to analyze this file. Please try a different audio track.');
    } finally {
      setIsAnalyzing(false);
    }
  }, []);

  const handleFileChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) {
        setSelectedFile(null);
        setAnalysis(null);
        return;
      }
      setSelectedFile(file);
      setAnalysis(null);
      setSuccessMessage(null);
      await analyzeAudio(file);
    },
    [analyzeAudio],
  );

  const handleSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!selectedFile || !analysis) {
        return;
      }
      setIsSubmitting(true);
      setErrorMessage(null);
      setSuccessMessage(null);
      try {
        const formData = new FormData();
        formData.append('file', selectedFile);
        const uploadRes = await fetch('/api/upload/audio', {
          method: 'POST',
          body: formData,
        });
        if (!uploadRes.ok) {
          throw new Error('Upload failed');
        }
        const { audioUrl } = await uploadRes.json();

        const createRes = await fetch('/api/projects/create', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            audioUrl,
            prompt: prompt.trim(),
            stylePreset,
            energy,
            duration: analysis.duration,
            tempo: analysis.tempo,
            beats: analysis.beats,
          }),
        });

        if (!createRes.ok) {
          throw new Error('Project creation failed');
        }

        const { projectId } = await createRes.json();
        setSuccessMessage('Project created! Redirecting…');
        router.push(`/projects/${projectId}`);
      } catch (error) {
        console.error('project-create', error);
        setErrorMessage('Something went wrong creating the project. Please try again.');
      } finally {
        setIsSubmitting(false);
      }
    },
    [analysis, energy, prompt, router, selectedFile, stylePreset],
  );

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-black text-white">
      <div className="mx-auto flex max-w-4xl flex-col gap-8 px-6 py-12">
        <header className="flex flex-col gap-3">
          <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-1 text-sm font-medium text-white/80">
            <Music4 className="h-4 w-4" />
            The Director · Music Video MVP
          </div>
          <h1 className="text-4xl font-semibold leading-tight">
            Upload a track, describe the vibe, and let the Director plan your music video.
          </h1>
          <p className="text-base text-white/70">
            We analyze beats locally (up to 60 seconds) with Mediabunny + Web Audio, keep your audio in Vercel Blob, and
            trigger the full workflow automatically.
          </p>
        </header>

        <form
          onSubmit={handleSubmit}
          className="rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur-xl"
        >
          <div className="grid gap-6">
            <div className="space-y-2">
              <label className="text-sm font-medium text-white/80">Audio file (MP3 or WAV)</label>
              <label
                className="flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-white/20 bg-black/30 px-6 py-12 text-center transition hover:border-white/50"
                htmlFor="audio-file"
              >
                <input
                  id="audio-file"
                  type="file"
                  accept="audio/mpeg,audio/wav,audio/mp3"
                  className="hidden"
                  onChange={handleFileChange}
                />
                <span className="text-lg font-medium">
                  {selectedFile ? selectedFile.name : 'Drop a file or click to browse'}
                </span>
                <span className="text-sm text-white/60">
                  {isAnalyzing ? 'Analyzing beats…' : 'Max 60 seconds · processed locally'}
                </span>
              </label>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm font-medium text-white/80">Style preset</label>
                <select
                  value={stylePreset}
                  onChange={(event) => setStylePreset(event.target.value as StylePresetValue)}
                  className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-white focus:border-white/40 focus:outline-none"
                >
                  {stylePresets.map((preset) => (
                    <option key={preset.value} value={preset.value} className="bg-slate-900 text-white">
                      {preset.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-white/80">Energy level</label>
                <select
                  value={energy}
                  onChange={(event) => setEnergy(event.target.value as EnergyValue)}
                  className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-white focus:border-white/40 focus:outline-none"
                >
                  {energyOptions.map((option) => (
                    <option key={option.value} value={option.value} className="bg-slate-900 text-white">
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-white/80">Creative direction prompt</label>
              <textarea
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder="e.g. Dreamy surreal forest visuals that bloom on every downbeat"
                rows={4}
                className="w-full resize-none rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-white focus:border-white/40 focus:outline-none"
              />
            </div>

            {analysis && (
              <div className="grid gap-4 rounded-xl border border-emerald-400/30 bg-emerald-400/5 p-4 text-emerald-100 sm:grid-cols-3">
                <div>
                  <div className="text-sm uppercase tracking-wide text-white/70">Duration</div>
                  <div className="text-2xl font-semibold">{analysis.duration}s</div>
                  {analysis.trimmed && (
                    <div className="text-xs text-white/70">Trimmed to 60s for the MVP pipeline.</div>
                  )}
                </div>
                <div>
                  <div className="text-sm uppercase tracking-wide text-white/70">Tempo</div>
                  <div className="text-2xl font-semibold">{analysis.tempo} BPM</div>
                </div>
                <div>
                  <div className="text-sm uppercase tracking-wide text-white/70">Beats detected</div>
                  <div className="text-2xl font-semibold">{analysis.beats.length}</div>
                </div>
              </div>
            )}

            {errorMessage && (
              <div className="rounded-xl border border-red-500/50 bg-red-500/10 px-4 py-3 text-sm text-red-100">
                {errorMessage}
              </div>
            )}

            {successMessage && (
              <div className="rounded-xl border border-emerald-500/50 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
                {successMessage}
              </div>
            )}

            <button
              type="submit"
              disabled={!canSubmit}
              className="inline-flex w-full items-center justify-center rounded-xl bg-emerald-400 px-4 py-3 text-lg font-semibold text-emerald-950 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:bg-emerald-400/40"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  Creating project…
                </>
              ) : (
                'Create project'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
