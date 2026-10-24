// SpacetimeDB-specific exports for the app's React provider + hooks.
// Isolated from backend/index.ts so that `mock` and `convex` consumers do NOT eagerly
// load the generated module_bindings.
//
// Usage (app/src/main.tsx):
//   import { createSpacetimeBuilder, tables } from '@prevent/realtime/spacetime';
//   import { SpacetimeDBProvider, useTable } from 'spacetimedb/react';
//
//   <SpacetimeDBProvider connectionBuilder={createSpacetimeBuilder({ uri, moduleName })}>
//     <App />
//   </SpacetimeDBProvider>

export { createSpacetimeBuilder } from './backend/spacetime';
export type { SpacetimeConfig } from './backend/spacetime';
export { tables, reducers, DbConnection } from './module_bindings';
export type {
  EventContext,
  ReducerEventContext,
  SubscriptionEventContext,
  ErrorContext,
} from './module_bindings';
