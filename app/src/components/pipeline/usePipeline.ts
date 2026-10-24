// React 19: read the pipeline context with use() (not useContext) and throw if
// a consumer is rendered outside the provider.

import { use } from 'react';
import { PipelineContext, type PipelineValue } from './PipelineProvider';

export function usePipeline(): PipelineValue {
  const ctx = use(PipelineContext);
  if (!ctx) {
    throw new Error('usePipeline must be used within a PipelineProvider');
  }
  return ctx;
}
