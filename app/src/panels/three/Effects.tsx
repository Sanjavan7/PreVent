// The single EffectComposer (spec §4). Exact order: Bloom -> ChromaticAberration
// -> ToneMapping(ACES) -> Vignette -> Noise.
//
// Tone-mapping lives here ONCE, as the last HDR-stage effect: the Canvas is
// `flat` (NoToneMapping) and the composer force-holds gl.toneMapping at
// NoToneMapping for its lifetime, so the #0097FE emissive (toneMapped={false},
// value > 1) survives untouched through Bloom into a HalfFloat buffer and only
// then gets the filmic curve. That chain is what stops the blue washing out.
//
// Bloom + ChromaticAberration take refs (via the shared SceneRefs bundle) so
// DeviceDriver can spike bloom intensity and widen the aberration on a crash
// from its one useFrame -- no React re-render. kernelSize is intentionally
// omitted: with mipmapBlur the kernel is ignored and `radius` controls spread.
//
// `tier` down-shifts cost without ever remounting the composer's core (Bloom +
// ToneMapping + Vignette always present): ChromaticAberration and Noise drop
// first, then multisampling and bloom quality. Dropping an effect nulls its ref,
// which DeviceDriver null-checks.

import { memo } from 'react';
import type { RefObject } from 'react';
import { HalfFloatType } from 'three';
import {
  Bloom,
  ChromaticAberration,
  EffectComposer,
  Noise,
  ToneMapping,
  Vignette,
} from '@react-three/postprocessing';
import type { BloomEffect, ChromaticAberrationEffect } from 'postprocessing';
import { BlendFunction, ToneMappingMode } from 'postprocessing';

export type PerfTier = 'HIGH' | 'MED' | 'LOW';

interface Props {
  tier: PerfTier;
  bloomRef: RefObject<BloomEffect | null>;
  chromaRef: RefObject<ChromaticAberrationEffect | null>;
}

export const Effects = memo(function Effects({
  tier,
  bloomRef,
  chromaRef,
}: Props) {
  const multisampling = tier === 'HIGH' ? 4 : tier === 'MED' ? 2 : 0;
  const bloomIntensity = tier === 'LOW' ? 0.5 : tier === 'MED' ? 0.8 : 0.9;
  const bloomRadius = tier === 'LOW' ? 0.5 : tier === 'MED' ? 0.65 : 0.7;
  const chroma = tier === 'HIGH';
  const noise = tier !== 'LOW';

  return (
    <EffectComposer multisampling={multisampling} frameBufferType={HalfFloatType}>
      <Bloom
        ref={bloomRef}
        mipmapBlur
        luminanceThreshold={0.9}
        luminanceSmoothing={0.08}
        intensity={bloomIntensity}
        radius={bloomRadius}
      />
      {chroma && (
        <ChromaticAberration
          ref={chromaRef}
          blendFunction={BlendFunction.NORMAL}
          offset={[0.0006, 0.0006]}
          radialModulation
          modulationOffset={0.3}
        />
      )}
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      <Vignette offset={0.28} darkness={0.9} />
      {noise && (
        <Noise
          premultiply
          blendFunction={BlendFunction.OVERLAY}
          opacity={0.035}
        />
      )}
    </EffectComposer>
  );
});
