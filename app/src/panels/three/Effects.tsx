// The single EffectComposer -- the MINIMAL bright stack (spec §6). Order:
// N8AO (ambient occlusion, HIGH only) -> Bloom (selective, low) -> ToneMapping
// (NEUTRAL). The old "dark horror" effects (ChromaticAberration / Vignette /
// Noise) are deleted -- they fought the bright/peaceful look.
//
// Tone-mapping is NEUTRAL (Khronos PBR Neutral), not ACES: it keeps whites white
// and the #0097FE accent hue true, where ACES muddies the blue and darkens mids.
// The Canvas is `flat` (NoToneMapping), so the composer owns the curve and the
// emissive screens (toneMapped={false}, value > 1) survive untouched through
// Bloom into a HalfFloat buffer before the NEUTRAL curve is applied.
//
// Bloom is selective + low (luminanceThreshold 1.0 -> only emissive screens /
// the judge-room halo bloom) and takes a ref so DeviceDriver can nudge its
// intensity on a crash from its one useFrame -- no React re-render.
//
// N8AO is a standalone Pass (confirmed exported by @react-three/postprocessing
// 3.2.2; `n8ao` 2.x is installed). It is mounted at HIGH only; PCSS +
// ContactShadows already ground the scene, so dropping it on MED/LOW is safe.
//
// `tier` down-shifts cost without remounting the composer core (Bloom +
// ToneMapping are always present): N8AO drops first, then multisampling.
// `chromaRef` is kept in the prop shape for <Scene> compatibility but is no
// longer wired to any effect (DeviceDriver null-checks it).

import { memo } from 'react';
import type { RefObject } from 'react';
import { HalfFloatType } from 'three';
import {
  Bloom,
  EffectComposer,
  N8AO,
  ToneMapping,
} from '@react-three/postprocessing';
import type { BloomEffect, ChromaticAberrationEffect } from 'postprocessing';
import { ToneMappingMode } from 'postprocessing';

export type PerfTier = 'HIGH' | 'MED' | 'LOW';

interface Props {
  tier: PerfTier;
  bloomRef: RefObject<BloomEffect | null>;
  chromaRef: RefObject<ChromaticAberrationEffect | null>;
}

export const Effects = memo(function Effects({ tier, bloomRef }: Props) {
  const multisampling = tier === 'LOW' ? 0 : 4;

  return (
    <EffectComposer multisampling={multisampling} frameBufferType={HalfFloatType}>
      {tier === 'HIGH' && (
        <N8AO
          aoRadius={1.2}
          distanceFalloff={1}
          intensity={1.1}
          color="#43566b"
          quality="medium"
          aoSamples={16}
          denoiseSamples={4}
          halfRes
        />
      )}
      <Bloom
        ref={bloomRef}
        mipmapBlur
        luminanceThreshold={1.0}
        luminanceSmoothing={0.2}
        intensity={0.35}
        radius={0.6}
      />
      <ToneMapping mode={ToneMappingMode.NEUTRAL} />
    </EffectComposer>
  );
});
